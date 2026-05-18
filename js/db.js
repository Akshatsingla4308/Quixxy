import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { assertFirebaseConfigured, db } from "../config/firebase.js";

const COLLECTIONS = {
  users: "users",
  quizzes: "quizzes",
  questions: "questions",
  attempts: "attempts",
  leaderboard: "leaderboard",
  teacherQuizzes: "teacher_quizzes",
  teacherQuestions: "teacher_questions"
};

function mapSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function sanitizeText(value) {
  return String(value ?? "").trim();
}

function getSortableTime(value) {
  if (value?.seconds) {
    return value.seconds;
  }

  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  return Number(value || 0);
}

function normalizeTeacherQuestion(question, index = 0) {
  const prompt = sanitizeText(question.question ?? question.prompt);
  const options = Array.isArray(question.options) ? question.options.map((option) => sanitizeText(option)) : [];
  const timer = Number(question.timer ?? question.timerSeconds ?? 30);

  return {
    id: question.id,
    quizId: question.quizId,
    question: prompt,
    prompt,
    options,
    correctAnswer: Number(question.correctAnswer || 0),
    timer: Number.isFinite(timer) ? Math.min(120, Math.max(5, timer)) : 30,
    order: Number(question.order || index + 1)
  };
}

function buildTeacherQuestionPayload({ quizId, question, index }) {
  const timer = Number(question.timerSeconds ?? question.timer ?? 30);

  return {
    quizId,
    question: sanitizeText(question.question ?? question.prompt),
    options: (question.options || []).map((option) => sanitizeText(option)),
    correctAnswer: Number(question.correctAnswer || 0),
    timer: Math.min(120, Math.max(5, Number.isFinite(timer) ? timer : 30)),
    order: index + 1,
    createdAt: serverTimestamp()
  };
}

export async function createUserProfile({ uid, name, email, role = "student" }) {
  assertFirebaseConfigured();

  const userRef = doc(db, COLLECTIONS.users, uid);
  await setDoc(
    userRef,
    {
      uid,
      name: sanitizeText(name) || "Quixxy User",
      email: sanitizeText(email),
      role,
      totalPoints: 0,
      attemptsCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return getUserProfile(uid);
}

export async function getUserProfile(uid) {
  assertFirebaseConfigured();

  const snapshot = await getDoc(doc(db, COLLECTIONS.users, uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getAvailableQuizzes({ includeDrafts = false } = {}) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.quizzes), orderBy("createdAt", "desc")));
  const quizzes = mapSnapshot(snapshot).map((quiz) => ({
    ...quiz,
    questionCount: Number(quiz.questionCount || 0),
    durationSeconds: Number(quiz.durationSeconds || 15)
  }));

  if (includeDrafts) {
    return quizzes;
  }

  return quizzes.filter((quiz) => quiz.status !== "draft" && quiz.status !== "archived");
}

export async function getAllQuizzes() {
  return getAvailableQuizzes({ includeDrafts: true });
}

export async function getQuizById(quizId) {
  assertFirebaseConfigured();

  const snapshot = await getDoc(doc(db, COLLECTIONS.quizzes, quizId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getQuestionsByQuizId(quizId) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.questions), where("quizId", "==", quizId)));

  return mapSnapshot(snapshot)
    .map((question) => ({
      ...question,
      order: Number(question.order || 0),
      correctAnswer: Number(question.correctAnswer || 0),
      options: Array.isArray(question.options) ? question.options : []
    }))
    .sort((left, right) => left.order - right.order);
}

export async function getTeacherQuizzes(teacherId) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.teacherQuizzes), where("teacherId", "==", teacherId))
  );

  const quizzes = mapSnapshot(snapshot).sort(
    (left, right) => getSortableTime(right.createdAt) - getSortableTime(left.createdAt)
  );

  return Promise.all(
    quizzes.map(async (quiz) => {
      if (Number.isInteger(quiz.questionCount)) {
        return {
          ...quiz,
          questionCount: Number(quiz.questionCount || 0)
        };
      }

      const questions = await getTeacherQuestionsByQuizId(quiz.id);
      return {
        ...quiz,
        questionCount: questions.length
      };
    })
  );
}

export async function getTeacherQuizById(quizId) {
  assertFirebaseConfigured();

  const snapshot = await getDoc(doc(db, COLLECTIONS.teacherQuizzes, quizId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getTeacherQuestionsByQuizId(quizId) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.teacherQuestions), where("quizId", "==", quizId)));

  return mapSnapshot(snapshot)
    .map((question, index) => normalizeTeacherQuestion(question, index))
    .sort((left, right) => left.order - right.order);
}

export async function saveTeacherQuizWithQuestions({ quiz, questions, teacher }) {
  assertFirebaseConfigured();

  const title = sanitizeText(quiz.title);

  if (!title) {
    throw new Error("Add a quiz title before saving.");
  }

  if (!questions.length) {
    throw new Error("Add at least one question before saving.");
  }

  const quizRef = doc(collection(db, COLLECTIONS.teacherQuizzes));

  // Teacher quizzes stay separate from the global admin quiz catalog.
  await setDoc(quizRef, {
    teacherId: teacher.uid,
    title,
    questionCount: questions.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const batch = writeBatch(db);

  questions.forEach((question, index) => {
    const questionRef = doc(collection(db, COLLECTIONS.teacherQuestions));
    batch.set(questionRef, buildTeacherQuestionPayload({ quizId: quizRef.id, question, index }));
  });

  await batch.commit();
  return quizRef.id;
}

export async function updateTeacherQuizWithQuestions({ quizId, quiz, questions, teacherId }) {
  assertFirebaseConfigured();

  const quizRef = doc(db, COLLECTIONS.teacherQuizzes, quizId);
  const quizSnapshot = await getDoc(quizRef);

  if (!quizSnapshot.exists()) {
    throw new Error("This teacher quiz could not be found.");
  }

  if (quizSnapshot.data().teacherId !== teacherId) {
    throw new Error("You can only edit your own teacher quizzes.");
  }

  const title = sanitizeText(quiz.title);

  if (!title) {
    throw new Error("Add a quiz title before updating.");
  }

  if (!questions.length) {
    throw new Error("Keep at least one question in the quiz.");
  }

  const existingQuestions = await getDocs(
    query(collection(db, COLLECTIONS.teacherQuestions), where("quizId", "==", quizId))
  );

  const batch = writeBatch(db);
  batch.update(quizRef, {
    title,
    questionCount: questions.length,
    updatedAt: serverTimestamp()
  });

  existingQuestions.docs.forEach((questionDoc) => {
    batch.delete(questionDoc.ref);
  });

  questions.forEach((question, index) => {
    const questionRef = doc(collection(db, COLLECTIONS.teacherQuestions));
    batch.set(questionRef, buildTeacherQuestionPayload({ quizId, question, index }));
  });

  await batch.commit();
}

export async function deleteTeacherQuizById({ quizId, teacherId }) {
  assertFirebaseConfigured();

  const quizRef = doc(db, COLLECTIONS.teacherQuizzes, quizId);
  const quizSnapshot = await getDoc(quizRef);

  if (!quizSnapshot.exists()) {
    return;
  }

  if (quizSnapshot.data().teacherId !== teacherId) {
    throw new Error("You can only delete your own teacher quizzes.");
  }

  const questionSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.teacherQuestions), where("quizId", "==", quizId))
  );
  const batch = writeBatch(db);

  questionSnapshot.docs.forEach((questionDoc) => {
    batch.delete(questionDoc.ref);
  });

  batch.delete(quizRef);
  await batch.commit();
}

export async function getUserAttemptStats(uid) {
  assertFirebaseConfigured();

  const snapshot = await getDocs(query(collection(db, COLLECTIONS.attempts), where("userId", "==", uid)));
  const attempts = mapSnapshot(snapshot);

  if (!attempts.length) {
    return {
      attemptsCount: 0,
      averagePercentage: 0,
      bestPercentage: 0,
      totalPoints: 0
    };
  }

  const attemptsCount = attempts.length;
  const totalPoints = attempts.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const percentages = attempts.map((item) => Number(item.percentage || 0));
  const averagePercentage = Math.round(percentages.reduce((sum, item) => sum + item, 0) / attemptsCount);
  const bestPercentage = Math.max(...percentages);

  return {
    attemptsCount,
    averagePercentage,
    bestPercentage,
    totalPoints
  };
}

export async function saveQuizWithQuestions({ quiz, questions, author }) {
  assertFirebaseConfigured();

  const quizCollection = collection(db, COLLECTIONS.quizzes);
  const quizRef = doc(quizCollection);
  const batch = writeBatch(db);

  batch.set(quizRef, {
    title: sanitizeText(quiz.title),
    category: sanitizeText(quiz.category),
    description: sanitizeText(quiz.description),
    difficulty: sanitizeText(quiz.difficulty) || "Intermediate",
    durationSeconds: Number(quiz.durationSeconds || 15),
    status: sanitizeText(quiz.status) || "published",
    questionCount: questions.length,
    createdBy: author.uid,
    createdByName: author.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  questions.forEach((question, index) => {
    const questionRef = doc(collection(db, COLLECTIONS.questions));

    batch.set(questionRef, {
      quizId: quizRef.id,
      prompt: sanitizeText(question.prompt),
      options: question.options.map((option) => sanitizeText(option)),
      correctAnswer: Number(question.correctAnswer),
      explanation: sanitizeText(question.explanation),
      order: index + 1,
      createdAt: serverTimestamp()
    });
  });

  await batch.commit();
  return quizRef.id;
}

export async function updateQuizMeta(quizId, payload) {
  assertFirebaseConfigured();

  await updateDoc(doc(db, COLLECTIONS.quizzes, quizId), {
    title: sanitizeText(payload.title),
    category: sanitizeText(payload.category),
    difficulty: sanitizeText(payload.difficulty),
    description: sanitizeText(payload.description),
    status: sanitizeText(payload.status),
    durationSeconds: Number(payload.durationSeconds || 15),
    updatedAt: serverTimestamp()
  });
}

export async function deleteQuizById(quizId) {
  assertFirebaseConfigured();

  const batch = writeBatch(db);
  const [questionSnapshot, leaderboardSnapshot] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.questions), where("quizId", "==", quizId))),
    getDocs(query(collection(db, COLLECTIONS.leaderboard), where("quizId", "==", quizId)))
  ]);

  questionSnapshot.docs.forEach((item) => batch.delete(item.ref));
  leaderboardSnapshot.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(doc(db, COLLECTIONS.quizzes, quizId));

  await batch.commit();
}

export async function getLeaderboardEntries(limitCount = 10) {
  assertFirebaseConfigured();

  const leaderboardQuery = query(
    collection(db, COLLECTIONS.leaderboard),
    orderBy("rankingScore", "desc"),
    limit(limitCount)
  );

  const snapshot = await getDocs(leaderboardQuery);
  return mapSnapshot(snapshot);
}

export async function saveAttemptRecord({ quiz, summary, answers, user }) {
  assertFirebaseConfigured();

  const displayName = sanitizeText(user.name) || sanitizeText(user.email) || "Quixxy User";

  const attemptRef = await addDoc(collection(db, COLLECTIONS.attempts), {
    quizId: quiz.id,
    quizTitle: sanitizeText(quiz.title),
    category: sanitizeText(quiz.category),
    userId: user.uid,
    userName: displayName,
    userRole: sanitizeText(user.role),
    score: Number(summary.score || 0),
    correctAnswers: Number(summary.correctAnswers || 0),
    totalQuestions: Number(summary.totalQuestions || 0),
    percentage: Number(summary.percentage || 0),
    answers,
    createdAt: serverTimestamp()
  });

  await setDoc(
    doc(db, COLLECTIONS.users, user.uid),
    {
      uid: user.uid,
      name: displayName,
      email: sanitizeText(user.email),
      role: sanitizeText(user.role) || "student",
      totalPoints: increment(Number(summary.score || 0)),
      attemptsCount: increment(1),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  const leaderboardRef = doc(db, COLLECTIONS.leaderboard, `${user.uid}_${quiz.id}`);
  const leaderboardSnapshot = await getDoc(leaderboardRef);
  const rankingScore = Number(summary.percentage || 0) * 1000 + Number(summary.score || 0);

  if (!leaderboardSnapshot.exists() || Number(leaderboardSnapshot.data().rankingScore || 0) < rankingScore) {
    await setDoc(
      leaderboardRef,
      {
        quizId: quiz.id,
        quizTitle: sanitizeText(quiz.title),
        category: sanitizeText(quiz.category),
        userId: user.uid,
        userName: displayName,
        score: Number(summary.score || 0),
        totalQuestions: Number(summary.totalQuestions || 0),
        percentage: Number(summary.percentage || 0),
        rankingScore,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  return attemptRef.id;
}

export async function getAllUsers() {
  assertFirebaseConfigured();

  const snapshot = await getDocs(collection(db, COLLECTIONS.users));

  return mapSnapshot(snapshot).sort((left, right) => {
    const leftTime = left.createdAt?.seconds || 0;
    const rightTime = right.createdAt?.seconds || 0;
    return rightTime - leftTime;
  });
}

export async function getUserSettings(uid) {
  assertFirebaseConfigured();
  const profile = await getUserProfile(uid);
  return profile?.settings || {};
}

export async function updateUserSettings(uid, settings = {}) {
  assertFirebaseConfigured();
  const userRef = doc(db, COLLECTIONS.users, uid);
  const snapshot = await getDoc(userRef);
  const previous = snapshot.exists() ? snapshot.data().settings || {} : {};
  const merged = { ...previous, ...settings };

  await setDoc(
    userRef,
    {
      settings: merged,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function getPlatformSettings() {
  assertFirebaseConfigured();
  const snapshot = await getDoc(doc(db, "platform_settings", "core"));
  return snapshot.exists() ? snapshot.data() : {};
}

export async function updatePlatformSettings(payload = {}) {
  assertFirebaseConfigured();
  await setDoc(
    doc(db, "platform_settings", "core"),
    {
      ...payload,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function seedDemoQuiz(author) {
  const sampleQuestions = [
    {
      prompt: "Which HTML element is semantically correct for the main navigation links of a page?",
      options: ["<section>", "<nav>", "<aside>", "<footer>"],
      correctAnswer: 1,
      explanation: "The <nav> element represents a section of navigation links."
    },
    {
      prompt: "What does CSS flexbox optimize first?",
      options: ["Two-dimensional page layout", "Component-level one-dimensional layout", "Database ordering", "Image compression"],
      correctAnswer: 1,
      explanation: "Flexbox is best for one-dimensional alignment and distribution."
    },
    {
      prompt: "Which JavaScript method converts a JSON string into an object?",
      options: ["JSON.stringify()", "JSON.parse()", "Object.from()", "Array.from()"],
      correctAnswer: 1,
      explanation: "JSON.parse() reads a JSON string into a JavaScript value."
    },
    {
      prompt: "What is the main reason to use async/await with Firestore calls?",
      options: ["To reduce CSS size", "To make async logic easier to read and control", "To avoid browser caching", "To create SVG sprites"],
      correctAnswer: 1,
      explanation: "Firestore operations are asynchronous, and async/await keeps that flow clean."
    },
    {
      prompt: "Which storage option is useful for preserving a result payload between quiz and result pages?",
      options: ["sessionStorage", "Clipboard API", "local CSS variables", "DOMParser"],
      correctAnswer: 0,
      explanation: "sessionStorage is a lightweight browser-side option for short-lived page-to-page state."
    }
  ];

  return saveQuizWithQuestions({
    quiz: {
      title: "Frontend Fundamentals",
      category: "Web Development",
      description: "A quick-fire quiz on HTML, CSS, JavaScript, and app architecture basics.",
      difficulty: "Intermediate",
      durationSeconds: 15,
      status: "published"
    },
    questions: sampleQuestions,
    author
  });
}
