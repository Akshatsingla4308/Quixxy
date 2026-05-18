import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { assertFirebaseConfigured, db } from "../config/firebase.js";

const SESSIONS = "sessions";
const DEFAULT_TIMER_SECONDS = 30;
const JOIN_ORIGIN = "https://quixxy.in";

function cleanText(value) {
  return String(value ?? "").trim();
}

function getSortableTime(value) {
  if (value?.seconds) {
    return value.seconds;
  }

  return Number(value || 0);
}

function toMillis(timestamp) {
  if (!timestamp) {
    return 0;
  }

  if (typeof timestamp.toMillis === "function") {
    return timestamp.toMillis();
  }

  if (timestamp.seconds) {
    return timestamp.seconds * 1000;
  }

  return Number(timestamp || 0);
}

export function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function normalizeCode(value) {
  return cleanText(value).replace(/\s+/g, "").toUpperCase();
}

export function buildDirectLink(code, origin) {
  const resolvedOrigin =
    origin ||
    (typeof globalThis !== "undefined" && globalThis.window?.location?.origin) ||
    JOIN_ORIGIN;
  return `${String(resolvedOrigin).replace(/\/$/, "")}/join.html?session=${encodeURIComponent(normalizeCode(code))}`;
}

export function getQuestionTimerSeconds(question, fallback = DEFAULT_TIMER_SECONDS) {
  const raw = Number(question?.timer ?? question?.timerSeconds ?? question?.durationSeconds ?? fallback);
  if (!Number.isFinite(raw)) {
    return Math.min(120, Math.max(5, Number(fallback)));
  }
  return Math.min(120, Math.max(5, raw));
}

export function getRemainingSeconds(session) {
  if (!session || session.status !== "live") {
    return Number(session?.remainingSeconds ?? session?.timer ?? DEFAULT_TIMER_SECONDS);
  }

  if (session.paused || session.questionClosed) {
    return Math.max(0, Number(session.remainingSeconds ?? session.timer ?? DEFAULT_TIMER_SECONDS));
  }

  const startedAt = toMillis(session.timerStartedAt);

  if (!startedAt) {
    return Number(session.timer || DEFAULT_TIMER_SECONDS);
  }

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, Number(session.timer || DEFAULT_TIMER_SECONDS) - elapsed);
}

function createParticipantKey() {
  if (window.crypto?.getRandomValues) {
    const values = new Uint32Array(4);
    window.crypto.getRandomValues(values);
    return [...values].map((value) => value.toString(36)).join("");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function toStudentQuestionPayload(question) {
  if (!question) {
    return null;
  }

  // Keep correct answers out of the public live payload while the question is active.
  return {
    question: cleanText(question.question ?? question.prompt),
    options: Array.isArray(question.options) ? question.options.map((option) => cleanText(option)) : []
  };
}

async function getUniqueSessionCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();
    const snapshot = await getDocs(query(collection(db, SESSIONS), where("code", "==", code), limit(1)));

    if (snapshot.empty) {
      return code;
    }
  }

  throw new Error("Could not generate a unique join code. Try again.");
}

export async function createSession({ quizId, teacherId, timer = DEFAULT_TIMER_SECONDS }) {
  assertFirebaseConfigured();

  const code = await getUniqueSessionCode();
  const origin = typeof globalThis !== "undefined" && globalThis.window?.location?.origin;
  const directLink = buildDirectLink(code, origin);
  const docRef = await addDoc(collection(db, SESSIONS), {
    teacherId,
    quizId,
    code,
    directLink,
    status: "waiting",
    currentQuestion: 0,
    currentQuestionPayload: null,
    timer: Number(timer || DEFAULT_TIMER_SECONDS),
    timerStartedAt: null,
    remainingSeconds: Number(timer || DEFAULT_TIMER_SECONDS),
    paused: true,
    questionClosed: false,
    answerStats: {},
    publicLeaderboard: [],
    leaderboardHistory: {},
    participantCount: 0,
    participationRate: 0,
    questionReview: [],
    createdAt: serverTimestamp(),
    endedAt: null,
    updatedAt: serverTimestamp()
  });

  return {
    sessionId: docRef.id,
    code,
    directLink
  };
}

export async function getSessionById(sessionId) {
  assertFirebaseConfigured();

  const snapshot = await getDoc(doc(db, SESSIONS, sessionId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function findSessionByCode(code) {
  assertFirebaseConfigured();

  const normalizedCode = normalizeCode(code);
  const snapshot = await getDocs(query(collection(db, SESSIONS), where("code", "==", normalizedCode), limit(1)));

  if (snapshot.empty) {
    return null;
  }

  const sessionDoc = snapshot.docs[0];
  return { id: sessionDoc.id, ...sessionDoc.data() };
}

export async function getTeacherSessions(teacherId) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(query(collection(db, SESSIONS), where("teacherId", "==", teacherId)));

  return snapshot.docs
    .map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() }))
    .sort((left, right) => getSortableTime(right.createdAt) - getSortableTime(left.createdAt));
}

export async function getSessionParticipants(sessionId) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(query(collection(db, SESSIONS, sessionId, "participants"), orderBy("score", "desc")));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function getSessionResponses(sessionId) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(collection(db, SESSIONS, sessionId, "responses"));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function joinLiveSession({ code, name }) {
  assertFirebaseConfigured();

  const session = await findSessionByCode(code);

  if (!session) {
    throw new Error("No live session matches that code.");
  }

  if (session.status === "ended") {
    throw new Error("This live quiz has already ended.");
  }

  const participantKey = createParticipantKey();
  const participantRef = await addDoc(collection(db, SESSIONS, session.id, "participants"), {
    name: cleanText(name) || "Guest",
    score: 0,
    answers: {},
    accuracy: 0,
    rank: 0,
    participantKey,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return {
    session,
    participantId: participantRef.id,
    participantKey
  };
}

export function listenSession(sessionId, onChange, onError) {
  assertFirebaseConfigured();

  return onSnapshot(
    doc(db, SESSIONS, sessionId),
    (snapshot) => {
      onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    },
    onError
  );
}

export function listenParticipants(sessionId, onChange, onError) {
  assertFirebaseConfigured();

  return onSnapshot(
    query(collection(db, SESSIONS, sessionId, "participants"), orderBy("score", "desc")),
    (snapshot) => {
      onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export function listenParticipant(sessionId, participantId, onChange, onError) {
  assertFirebaseConfigured();

  return onSnapshot(
    doc(db, SESSIONS, sessionId, "participants", participantId),
    (snapshot) => {
      onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    },
    onError
  );
}

export function listenResponses(sessionId, onChange, onError) {
  assertFirebaseConfigured();

  return onSnapshot(
    collection(db, SESSIONS, sessionId, "responses"),
    (snapshot) => {
      onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export async function startLiveSession({ sessionId, question, timer = DEFAULT_TIMER_SECONDS }) {
  assertFirebaseConfigured();

  await updateDoc(doc(db, SESSIONS, sessionId), {
    status: "live",
    currentQuestion: 0,
    currentQuestionPayload: toStudentQuestionPayload(question),
    timer: Number(timer || DEFAULT_TIMER_SECONDS),
    timerStartedAt: serverTimestamp(),
    remainingSeconds: Number(timer || DEFAULT_TIMER_SECONDS),
    paused: false,
    questionClosed: false,
    revealedCorrectAnswer: deleteField(),
    updatedAt: serverTimestamp()
  });
}

export async function moveToQuestion({ sessionId, questionIndex, question, timer = DEFAULT_TIMER_SECONDS }) {
  assertFirebaseConfigured();

  await updateDoc(doc(db, SESSIONS, sessionId), {
    status: "live",
    currentQuestion: Number(questionIndex || 0),
    currentQuestionPayload: toStudentQuestionPayload(question),
    timer: Number(timer || DEFAULT_TIMER_SECONDS),
    timerStartedAt: serverTimestamp(),
    remainingSeconds: Number(timer || DEFAULT_TIMER_SECONDS),
    paused: false,
    questionClosed: false,
    revealedCorrectAnswer: deleteField(),
    updatedAt: serverTimestamp()
  });
}

export async function pauseLiveTimer({ sessionId, remainingSeconds }) {
  assertFirebaseConfigured();

  await updateDoc(doc(db, SESSIONS, sessionId), {
    paused: true,
    remainingSeconds: Math.max(0, Number(remainingSeconds || 0)),
    updatedAt: serverTimestamp()
  });
}

export async function resumeLiveTimer({ sessionId, remainingSeconds }) {
  assertFirebaseConfigured();

  const nextTimer = Math.max(1, Number(remainingSeconds || DEFAULT_TIMER_SECONDS));

  await updateDoc(doc(db, SESSIONS, sessionId), {
    paused: false,
    timer: nextTimer,
    remainingSeconds: nextTimer,
    timerStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function adjustLiveTimer({ sessionId, remainingSeconds }) {
  assertFirebaseConfigured();

  const nextTimer = Math.max(1, Number(remainingSeconds || 1));

  await updateDoc(doc(db, SESSIONS, sessionId), {
    timer: nextTimer,
    remainingSeconds: nextTimer,
    timerStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function closeCurrentQuestion({ sessionId, answerStats, revealedCorrectAnswer }) {
  assertFirebaseConfigured();

  const payload = {
    paused: true,
    remainingSeconds: 0,
    questionClosed: true,
    answerStats,
    updatedAt: serverTimestamp()
  };

  if (Number.isInteger(revealedCorrectAnswer) && revealedCorrectAnswer >= 0 && revealedCorrectAnswer <= 3) {
    payload.revealedCorrectAnswer = revealedCorrectAnswer;
  }

  await updateDoc(doc(db, SESSIONS, sessionId), payload);
}

export async function endLiveSession({ sessionId, answerStats = {}, questionReview = [] }) {
  assertFirebaseConfigured();

  await updateDoc(doc(db, SESSIONS, sessionId), {
    status: "ended",
    paused: true,
    remainingSeconds: 0,
    questionClosed: true,
    currentQuestionPayload: null,
    answerStats,
    questionReview,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function submitLiveAnswer({ sessionId, participantId, participantKey, questionIndex, selectedOption }) {
  assertFirebaseConfigured();

  const responseId = `${participantId}_${questionIndex}`;
  await setDoc(doc(db, SESSIONS, sessionId, "responses", responseId), {
    participantId,
    participantKey,
    questionIndex: Number(questionIndex),
    selectedOption: Number(selectedOption),
    answer: Number(selectedOption),
    isCorrect: false,
    answeredAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });
}

export async function syncSessionAnalytics({
  sessionId,
  participantSummaries = [],
  responseSummaries = [],
  sessionSummary = {}
}) {
  assertFirebaseConfigured();

  const batch = writeBatch(db);

  participantSummaries.forEach((participant) => {
    const participantRef = doc(db, SESSIONS, sessionId, "participants", participant.id);
    batch.update(participantRef, {
      score: Number(participant.score || 0),
      answers: participant.answers || {},
      accuracy: Number(participant.accuracy || 0),
      rank: Number(participant.rank || 0),
      updatedAt: serverTimestamp()
    });
  });

  responseSummaries.forEach((response) => {
    const responseRef = doc(db, SESSIONS, sessionId, "responses", response.id);
    batch.update(responseRef, {
      isCorrect: Boolean(response.isCorrect)
    });
  });

  batch.update(doc(db, SESSIONS, sessionId), {
    ...sessionSummary,
    updatedAt: serverTimestamp()
  });

  await batch.commit();
}
