import { isFirebaseConfigured } from "../config/firebase.js";
import { requireAuth, signOutCurrentUser } from "./auth.js";
import { getTeacherQuestionsByQuizId, getTeacherQuizById } from "./db.js";
import {
  adjustLiveTimer,
  buildDirectLink,
  closeCurrentQuestion,
  endLiveSession,
  getQuestionTimerSeconds,
  getRemainingSeconds,
  getSessionById,
  listenParticipants,
  listenResponses,
  listenSession,
  moveToQuestion,
  pauseLiveTimer,
  resumeLiveTimer,
  startLiveSession,
  syncSessionAnalytics
} from "./live.js";
import { applyStoredTheme, bindThemeToggle } from "./theme.js";
import { escapeHTML, renderPageMessage, setButtonLoading, setTextContent, showToast } from "./ui.js";

const DEFAULT_TIMER_SECONDS = 30;
const TIMER_STEP_SECONDS = 5;

let teacherProfile = null;
let sessionId = "";
let sessionData = null;
let quiz = null;
let questions = [];
let participants = [];
let responses = [];
let analyticsSyncRunning = false;
let lastAnalyticsSignature = "";
let autoClosedQuestionKey = "";
let timerIntervalId = null;
let analyticsSyncTimerId = null;
let unsubscribeSession = null;
let unsubscribeParticipants = null;
let unsubscribeResponses = null;

document.addEventListener("DOMContentLoaded", () => {
  initTeacherLivePage().catch((error) => {
    console.error(error);
    showToast(getErrorMessage(error, "Live host page could not load."), "error");
  });
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(timerIntervalId);
  window.clearTimeout(analyticsSyncTimerId);
  unsubscribeSession?.();
  unsubscribeParticipants?.();
  unsubscribeResponses?.();
});

function getErrorMessage(error, fallback = "Something went wrong.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

function attachLogout(button) {
  button?.addEventListener("click", async () => {
    try {
      await signOutCurrentUser();
      window.location.assign("./login.html");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to sign out right now."), "error");
    }
  });
}

function blockLivePage(message) {
  renderPageMessage(document.querySelector("main"), {
    title: "Live session unavailable",
    description: message,
    actions: [{ label: "Back to Teacher Dashboard", href: "./teacher.html", variant: "btn-secondary" }]
  });
}

async function initTeacherLivePage() {
  applyStoredTheme();
  bindThemeToggle();
  const session = await requireAuth({ allowedRoles: ["teacher"] });

  if (!session) {
    if (!isFirebaseConfigured) {
      blockLivePage("Update config/firebase.js before hosting live quizzes.");
    }
    return;
  }

  teacherProfile = session.profile;
  sessionId = new URLSearchParams(window.location.search).get("sessionId") || "";

  if (!sessionId) {
    blockLivePage("Open a session from the teacher dashboard to host a live quiz.");
    return;
  }

  sessionData = await getSessionById(sessionId);

  if (!sessionData) {
    blockLivePage("This live session could not be found.");
    return;
  }

  if (sessionData.teacherId !== teacherProfile.uid) {
    blockLivePage("This live session belongs to a different teacher account.");
    return;
  }

  quiz = await getTeacherQuizById(sessionData.quizId);
  questions = await getTeacherQuestionsByQuizId(sessionData.quizId);

  if (!quiz || !questions.length) {
    blockLivePage("The private quiz for this live session is missing questions.");
    return;
  }

  attachLogout(document.querySelector("#logout-button"));
  bindLiveControls();
  setTextContent("#teacher-live-user", teacherProfile.name || teacherProfile.email || "Teacher");
  setTextContent("#teacher-live-title", quiz.title || "Teacher quiz");
  setTextContent("#session-code", sessionData.code || "------");
  setTextContent("#join-url", getDirectLink());

  startRealtimeListeners();
  startTimerLoop();
  renderLiveState();
}

function getDirectLink() {
  const code = sessionData?.code || "";
  if (!code) {
    return "";
  }

  return buildDirectLink(code, typeof window !== "undefined" ? window.location.origin : undefined);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function bindLiveControls() {
  document.querySelector("#copy-link-button")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getDirectLink());
      showToast("Direct join link copied.", "success");
    } catch (error) {
      showToast("Copy failed. Select the link text manually.", "warning");
    }
  });

  document.querySelector("#start-live-button")?.addEventListener("click", async () => {
    const button = document.querySelector("#start-live-button");
    const timer = getQuestionTimerSeconds(questions[0], DEFAULT_TIMER_SECONDS);

    try {
      setButtonLoading(button, true, "Starting...");
      await startLiveSession({ sessionId, question: questions[0], timer });
      sessionData = {
        ...sessionData,
        status: "live",
        currentQuestion: 0,
        timer,
        remainingSeconds: timer,
        paused: false,
        questionClosed: false
      };
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to start quiz."), "error");
    } finally {
      setButtonLoading(button, false);
      renderLiveState();
    }
  });

  document.querySelector("#pause-timer-button")?.addEventListener("click", async () => {
    if (!sessionData || sessionData.status !== "live" || sessionData.questionClosed) {
      return;
    }

    const remainingSeconds = getRemainingSeconds(sessionData);

    try {
      if (sessionData.paused) {
        await resumeLiveTimer({ sessionId, remainingSeconds });
        sessionData = { ...sessionData, paused: false, timer: remainingSeconds, remainingSeconds };
      } else {
        await pauseLiveTimer({ sessionId, remainingSeconds });
        sessionData = { ...sessionData, paused: true, remainingSeconds };
      }

      renderLiveState();
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to update the timer."), "error");
    }
  });

  document.querySelector("#increase-timer-button")?.addEventListener("click", () => adjustTimer(TIMER_STEP_SECONDS));
  document.querySelector("#decrease-timer-button")?.addEventListener("click", () => adjustTimer(-TIMER_STEP_SECONDS));
  document.querySelector("#skip-question-button")?.addEventListener("click", () => goToNextQuestion({ skipped: true }));
  document.querySelector("#next-question-button")?.addEventListener("click", () => goToNextQuestion());

  document.querySelector("#end-session-button")?.addEventListener("click", async () => {
    if (!window.confirm("End this live quiz for every participant?")) {
      return;
    }

    try {
      const currentIndex = Number(sessionData?.currentQuestion || 0);
      if (sessionData?.status === "live" && !sessionData.questionClosed) {
        const stats = buildAllAnswerStats();
        const correct = Number(questions[currentIndex]?.correctAnswer ?? 0);
        await closeCurrentQuestion({ sessionId, answerStats: stats, revealedCorrectAnswer: correct });
      }

      await syncComputedSessionState({ includeReview: true });
      await endLiveSession({
        sessionId,
        answerStats: buildAllAnswerStats(),
        questionReview: buildQuestionReview()
      });
      sessionData = { ...sessionData, status: "ended", paused: true, remainingSeconds: 0, questionClosed: true };
      renderLiveState();
      showToast("Live session ended.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to end this session."), "error");
    }
  });
}

async function adjustTimer(deltaSeconds) {
  if (!sessionData || sessionData.status !== "live" || sessionData.questionClosed) {
    return;
  }

  const nextRemaining = Math.max(1, getRemainingSeconds(sessionData) + deltaSeconds);

  try {
    await adjustLiveTimer({ sessionId, remainingSeconds: nextRemaining });
    sessionData = { ...sessionData, timer: nextRemaining, remainingSeconds: nextRemaining };
    renderLiveState();
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to adjust the timer."), "error");
  }
}

async function goToNextQuestion({ skipped = false } = {}) {
  if (!sessionData || sessionData.status === "ended") {
    return;
  }

  const currentIndex = Number(sessionData.currentQuestion || 0);
  const nextIndex = currentIndex + 1;

  if (nextIndex >= questions.length) {
    if (skipped) {
      showToast("This is the final question. End the session when ready.", "info");
    } else {
      showToast("You are already on the final question. Use End Session when ready.", "info");
    }
    return;
  }

  try {
    if (sessionData.status === "live" && !sessionData.questionClosed) {
      await syncComputedSessionState();
      const correct = Number(questions[currentIndex]?.correctAnswer ?? 0);
      const stats = buildAllAnswerStats();
      await closeCurrentQuestion({ sessionId, answerStats: stats, revealedCorrectAnswer: correct });
      sessionData = {
        ...sessionData,
        questionClosed: true,
        paused: true,
        remainingSeconds: 0,
        revealedCorrectAnswer: correct,
        answerStats: stats
      };
      renderLiveState();
      await delay(skipped ? 650 : 1100);
    }

    await syncComputedSessionState();
    const nextTimer = getQuestionTimerSeconds(questions[nextIndex], DEFAULT_TIMER_SECONDS);
    await moveToQuestion({
      sessionId,
      questionIndex: nextIndex,
      question: questions[nextIndex],
      timer: nextTimer
    });
    autoClosedQuestionKey = "";
    sessionData = {
      ...sessionData,
      status: "live",
      currentQuestion: nextIndex,
      timer: nextTimer,
      paused: false,
      questionClosed: false,
      remainingSeconds: nextTimer
    };
    renderLiveState();
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to move to the next question."), "error");
  }
}

function startRealtimeListeners() {
  unsubscribeSession = listenSession(
    sessionId,
    (nextSession) => {
      sessionData = nextSession;
      setTextContent("#join-url", getDirectLink());
      renderLiveState();
    },
    (error) => showToast(getErrorMessage(error, "Session listener stopped."), "error")
  );

  unsubscribeParticipants = listenParticipants(
    sessionId,
    (nextParticipants) => {
      participants = nextParticipants;
      renderPeopleAndScores();
    },
    (error) => showToast(getErrorMessage(error, "Participant listener stopped."), "error")
  );

  unsubscribeResponses = listenResponses(
    sessionId,
    (nextResponses) => {
      responses = nextResponses;
      renderPeopleAndScores();
    },
    (error) => showToast(getErrorMessage(error, "Response listener stopped."), "error")
  );
}

function startTimerLoop() {
  window.clearInterval(timerIntervalId);
  timerIntervalId = window.setInterval(() => {
    updateTimerUI();
  }, 500);
}

function updateTimerUI() {
  if (!sessionData) {
    return;
  }

  const remainingSeconds = getRemainingSeconds(sessionData);
  const timer = Math.max(1, Number(sessionData.timer || DEFAULT_TIMER_SECONDS));
  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / timer) * 100));

  setTextContent("#live-timer-display", `${remainingSeconds}s`);
  setTextContent(
    "#timer-state-copy",
    sessionData.status === "ended"
      ? "Session complete."
      : sessionData.questionClosed
        ? "Time is up. Review the responses or move ahead."
        : sessionData.paused
          ? "Timer paused."
          : "Timer running across student devices."
  );

  const progressBar = document.querySelector("#teacher-live-progress-bar");

  if (progressBar) {
    progressBar.style.width = `${progressPercent}%`;
  }

  if (sessionData.status === "live" && !sessionData.paused && !sessionData.questionClosed && remainingSeconds <= 0) {
    closeQuestionAfterTimer();
  }
}

async function closeQuestionAfterTimer() {
  const currentIndex = Number(sessionData?.currentQuestion || 0);
  const closeKey = `${sessionId}_${currentIndex}`;

  if (autoClosedQuestionKey === closeKey) {
    return;
  }

  try {
    autoClosedQuestionKey = closeKey;
    const answerStats = buildAllAnswerStats();
    const correct = Number(questions[currentIndex]?.correctAnswer ?? 0);
    await syncComputedSessionState();
    await closeCurrentQuestion({ sessionId, answerStats, revealedCorrectAnswer: correct });
    sessionData = {
      ...sessionData,
      paused: true,
      questionClosed: true,
      remainingSeconds: 0,
      revealedCorrectAnswer: correct,
      answerStats
    };
    renderLiveState();
  } catch (error) {
    autoClosedQuestionKey = "";
    showToast(getErrorMessage(error, "Unable to close this question."), "error");
  }
}

function renderLiveState() {
  if (!sessionData) {
    return;
  }

  const status = sessionData.status || "waiting";
  const currentIndex = Number(sessionData.currentQuestion || 0);
  const currentQuestion = questions[currentIndex];
  const startButton = document.querySelector("#start-live-button");
  const pauseButton = document.querySelector("#pause-timer-button");
  const decreaseButton = document.querySelector("#decrease-timer-button");
  const increaseButton = document.querySelector("#increase-timer-button");
  const skipButton = document.querySelector("#skip-question-button");
  const nextButton = document.querySelector("#next-question-button");
  const endButton = document.querySelector("#end-session-button");

  setTextContent("#session-status", status);
  document.querySelector("#session-status")?.classList.remove("status-waiting", "status-live", "status-ended");
  document.querySelector("#session-status")?.classList.add(`status-${status}`);

  if (startButton) startButton.disabled = status !== "waiting";
  if (pauseButton) {
    pauseButton.disabled = status !== "live" || sessionData.questionClosed;
    pauseButton.textContent = sessionData.paused ? "Resume Timer" : "Pause Timer";
  }
  if (decreaseButton) decreaseButton.disabled = status !== "live" || sessionData.questionClosed;
  if (increaseButton) increaseButton.disabled = status !== "live" || sessionData.questionClosed;
  if (skipButton) skipButton.disabled = status !== "live" || currentIndex >= questions.length - 1;
  if (nextButton) nextButton.disabled = status !== "live" || currentIndex >= questions.length - 1;
  if (endButton) endButton.disabled = status === "ended";

  setTextContent("#teacher-live-progress", `Question ${Math.min(currentIndex + 1, questions.length)} of ${questions.length}`);
  setTextContent("#participant-count", `${participants.length} participant${participants.length === 1 ? "" : "s"}`);
  updateTimerUI();

  if (status === "waiting") {
    setTextContent("#teacher-current-label", "Waiting room");
    setTextContent("#teacher-current-question", "Participants can join with the code and direct link above.");
    document.querySelector("#teacher-question-options").innerHTML = "";
    setTextContent("#current-response-count", "0 answered");
    renderPeopleAndScores();
    return;
  }

  if (status === "ended") {
    setTextContent("#teacher-current-label", "Session ended");
    setTextContent("#teacher-current-question", "Final scores, accuracy, and answer review are saved for this session.");
    document.querySelector("#teacher-question-options").innerHTML = "";
    renderPeopleAndScores();
    return;
  }

  setTextContent("#teacher-current-label", sessionData.questionClosed ? "Review" : `Question ${currentIndex + 1}`);
  setTextContent("#teacher-current-question", currentQuestion?.question || "Question unavailable.");
  document.querySelector("#teacher-question-options").innerHTML = (currentQuestion?.options || [])
    .map(
      (option, index) => `
        <div class="option-button teacher-option ${Number(currentQuestion.correctAnswer) === index ? "correct" : ""}">
          <span class="option-key">${String.fromCharCode(65 + index)}</span>
          <span>${escapeHTML(option)}</span>
        </div>
      `
    )
    .join("");

  renderPeopleAndScores();
}

function renderPeopleAndScores() {
  const rows = buildScoreRows();
  renderParticipantList(rows);
  renderLeaderboard(rows);
  renderAnswerDistribution();
  renderAnswerStatus();
  updateResponseCount();
  scheduleComputedSessionStateSync();
}

function scheduleComputedSessionStateSync() {
  if (!sessionData || sessionData.status === "waiting") {
    return;
  }

  window.clearTimeout(analyticsSyncTimerId);
  analyticsSyncTimerId = window.setTimeout(() => {
    syncComputedSessionState();
  }, 300);
}

function buildScoreRows() {
  const responseByParticipantQuestion = new Map();

  responses.forEach((response) => {
    responseByParticipantQuestion.set(`${response.participantId}_${Number(response.questionIndex)}`, response);
  });

  const rows = participants.map((participant) => {
    const answers = {};
    let score = 0;
    let answeredCount = 0;

    questions.forEach((question, questionIndex) => {
      const response = responseByParticipantQuestion.get(`${participant.id}_${questionIndex}`);
      const selectedOption = response ? Number(response.selectedOption ?? response.answer) : null;
      const isAnswered = Number.isInteger(selectedOption);
      const isCorrect = isAnswered && selectedOption === Number(question.correctAnswer);

      if (isAnswered) {
        answeredCount += 1;
      }

      if (isCorrect) {
        score += 1;
      }

      answers[String(questionIndex)] = {
        questionIndex,
        selectedOption,
        isCorrect,
        answeredAt: response?.answeredAt || null
      };
    });

    return {
      ...participant,
      answers,
      computedScore: score,
      answeredCount,
      accuracy: questions.length ? Math.round((score / questions.length) * 100) : 0
    };
  });

  rows.sort((left, right) => {
    if (right.computedScore !== left.computedScore) {
      return right.computedScore - left.computedScore;
    }

    if (right.accuracy !== left.accuracy) {
      return right.accuracy - left.accuracy;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

function buildResponseSummaries() {
  return responses.map((response) => {
    const question = questions[Number(response.questionIndex)];
    const selectedOption = Number(response.selectedOption ?? response.answer);

    return {
      id: response.id,
      isCorrect: Boolean(question && selectedOption === Number(question.correctAnswer))
    };
  });
}

function renderParticipantList(rows) {
  const container = document.querySelector("#participant-list");

  if (!container) {
    return;
  }

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No participants yet</h3>
        <p>Share the session code or direct link and this list will update in realtime.</p>
      </div>
    `;
    return;
  }

  const currentIndex = Number(sessionData?.currentQuestion || 0);

  container.innerHTML = rows
    .map((participant) => {
      const answer = participant.answers?.[String(currentIndex)];
      const answered = Number.isInteger(answer?.selectedOption);
      const status = !answered ? "Idle" : answer.isCorrect ? "Answered" : "Answered";
      const statusClass = !answered ? "status-waiting" : answer.isCorrect ? "status-live" : "status-ended";
      const connectionStatus = getConnectionStatus(participant);
      const connectionClass = connectionStatus === "online" ? "status-live" : "status-ended";

      return `
        <article class="participant-row">
          <div>
            <div class="participant-header-row">
              <span>${escapeHTML(participant.name || "Guest")}</span>
              <span class="status-badge ${connectionClass}" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">${connectionStatus}</span>
            </div>
            <small class="muted-copy">Rank ${participant.rank} | ${participant.accuracy}% accuracy</small>
          </div>
          <div class="participant-score-stack">
            <strong>${Number(participant.computedScore || 0)} pts</strong>
            <span class="status-badge ${statusClass}">${status}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function getConnectionStatus(participant) {
  // Check if participant has recent activity (answeredAt timestamp)
  const currentIndex = Number(sessionData?.currentQuestion || 0);
  const answer = participant.answers?.[String(currentIndex)];
  
  if (answer?.answeredAt) {
    const answeredAt = toMillis(answer.answeredAt);
    const now = Date.now();
    const timeSinceAnswer = now - answeredAt;
    
    // If answered within the last 30 seconds, consider online
    if (timeSinceAnswer < 30000) {
      return "Online";
    }
  }
  
  // Check if participant has any recent activity across all questions
  const lastActivity = getLastActivityTime(participant);
  if (lastActivity) {
    const timeSinceActivity = Date.now() - lastActivity;
    if (timeSinceActivity < 60000) {
      return "Online";
    }
  }
  
  return "Idle";
}

function getLastActivityTime(participant) {
  let latestTime = 0;
  
  Object.values(participant.answers || {}).forEach((answer) => {
    if (answer.answeredAt) {
      const time = toMillis(answer.answeredAt);
      if (time > latestTime) {
        latestTime = time;
      }
    }
  });
  
  // Also check joinedAt timestamp
  if (participant.joinedAt) {
    const joinedTime = toMillis(participant.joinedAt);
    if (joinedTime > latestTime) {
      latestTime = joinedTime;
    }
  }
  
  return latestTime || null;
}

function renderLeaderboard(rows) {
  const container = document.querySelector("#live-leaderboard");

  if (!container) {
    return;
  }

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Leaderboard is waiting</h3>
        <p>Scores appear as participants answer questions.</p>
      </div>
    `;
    return;
  }

  // Track previous scores to detect changes
  const previousScores = new Map();
  container.querySelectorAll('.lb-score').forEach((el, idx) => {
    const score = parseInt(el.textContent);
    if (!isNaN(score)) {
      previousScores.set(idx, score);
    }
  });

  container.innerHTML = `
    <ol class="leaderboard-list live-leaderboard-list">
      ${rows
        .map(
          (participant, index) => {
            const isTop = index === 0;
            const previousScore = previousScores.get(index);
            const scoreIncreased = previousScore !== undefined && Number(participant.computedScore || 0) > previousScore;
            const scoreClass = scoreIncreased ? 'score-increase' : '';
            return `
            <li class="leaderboard-item live-lb-row ${isTop ? "lb-top" : ""}">
              <span class="leaderboard-rank">${index + 1}</span>
              <div>
                <div class="leaderboard-name">${escapeHTML(participant.name || "Guest")}</div>
                <div class="leaderboard-meta">${participant.accuracy}% accuracy</div>
              </div>
              <div class="leaderboard-score">
                <strong class="lb-score ${scoreClass}">${Number(participant.computedScore || 0)}</strong>
                <span class="leaderboard-meta">pts</span>
              </div>
            </li>
          `;
          }
        )
        .join("")}
    </ol>
  `;
}

function getCurrentQuestionStats() {
  return buildQuestionStats(Number(sessionData?.currentQuestion || 0));
}

function buildQuestionStats(questionIndex) {
  const question = questions[questionIndex];
  const currentResponses = responses.filter((response) => Number(response.questionIndex) === questionIndex);
  const responseByParticipant = new Map(currentResponses.map((response) => [response.participantId, response]));
  const counts = [0, 0, 0, 0];
  const correctNames = [];
  const wrongNames = [];
  const missingNames = [];

  participants.forEach((participant) => {
    const response = responseByParticipant.get(participant.id);

    if (!response) {
      missingNames.push(participant.name || "Guest");
      return;
    }

    const selectedOption = Number(response.selectedOption ?? response.answer);
    counts[selectedOption] = Number(counts[selectedOption] || 0) + 1;

    if (selectedOption === Number(question?.correctAnswer)) {
      correctNames.push(participant.name || "Guest");
    } else {
      wrongNames.push(participant.name || "Guest");
    }
  });

  const answeredCount = currentResponses.length;
  const totalParticipants = participants.length;

  return {
    questionIndex,
    totalParticipants,
    answeredCount,
    correctCount: correctNames.length,
    wrongCount: wrongNames.length,
    missingCount: missingNames.length,
    participationRate: totalParticipants ? Math.round((answeredCount / totalParticipants) * 100) : 0,
    options: counts.map((count, index) => ({
      label: String.fromCharCode(65 + index),
      text: question?.options?.[index] || `Option ${String.fromCharCode(65 + index)}`,
      count,
      percentage: answeredCount ? Math.round((count / answeredCount) * 100) : 0
    })),
    correctNames,
    wrongNames,
    missingNames
  };
}

function buildAllAnswerStats() {
  const stats = { ...(sessionData?.answerStats || {}) };

  questions.forEach((question, index) => {
    stats[String(index)] = buildQuestionStats(index);
  });

  stats.current = getCurrentQuestionStats();
  return stats;
}

function renderAnswerDistribution() {
  const container = document.querySelector("#answer-distribution");

  if (!container) {
    return;
  }

  const stats = getCurrentQuestionStats();

  if (!participants.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No answers yet</h3>
        <p>Distribution bars will fill as students submit responses.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = stats.options
    .map(
      (option, barIndex) => `
        <article class="distribution-row distribution-row--enter">
          <div class="distribution-label">
            <strong>${option.label}</strong>
            <span>${escapeHTML(option.text)}</span>
          </div>
          <div class="distribution-track">
            <div class="distribution-fill distribution-fill--animated" style="width: ${option.percentage}%; --bar-delay:${barIndex * 60}ms"></div>
          </div>
          <span>${option.percentage}%</span>
        </article>
      `
    )
    .join("");
}

function renderAnswerStatus() {
  const container = document.querySelector("#answer-status-list");

  if (!container) {
    return;
  }

  const stats = getCurrentQuestionStats();
  const renderNames = (names) => (names.length ? names.map((name) => `<span>${escapeHTML(name)}</span>`).join("") : "<span>None</span>");

  container.innerHTML = `
    <article class="answer-status-card correct">
      <strong>${stats.correctCount}</strong>
      <span>Correct</span>
      <div>${renderNames(stats.correctNames)}</div>
    </article>
    <article class="answer-status-card incorrect">
      <strong>${stats.wrongCount}</strong>
      <span>Wrong</span>
      <div>${renderNames(stats.wrongNames)}</div>
    </article>
    <article class="answer-status-card unanswered">
      <strong>${stats.missingCount}</strong>
      <span>No answer</span>
      <div>${renderNames(stats.missingNames)}</div>
    </article>
  `;
}

function updateResponseCount() {
  if (!sessionData || sessionData.status !== "live") {
    setTextContent("#current-response-count", "0 answered");
    return;
  }

  const stats = getCurrentQuestionStats();
  setTextContent("#current-response-count", `${stats.answeredCount} of ${participants.length} answered`);
}

async function syncComputedSessionState({ includeReview = false } = {}) {
  if (analyticsSyncRunning || !sessionData || sessionData.status === "waiting") {
    return;
  }

  const rows = buildScoreRows();
  const answerStats = buildAllAnswerStats();
  const publicLeaderboard = rows.slice(0, 8).map((row) => ({
    name: row.name || "Guest",
    score: row.computedScore,
    accuracy: row.accuracy,
    rank: row.rank
  }));
  const currentStats = getCurrentQuestionStats();
  const leaderboardHistory = {
    ...(sessionData.leaderboardHistory || {}),
    [String(sessionData.currentQuestion || 0)]: publicLeaderboard
  };
  const sessionSummary = {
    answerStats,
    publicLeaderboard,
    leaderboardHistory,
    participantCount: participants.length,
    participationRate: currentStats.participationRate
  };

  if (includeReview || sessionData.status === "ended") {
    sessionSummary.questionReview = buildQuestionReview();
  }

  const participantSummaries = rows.map((row) => ({
    id: row.id,
    score: row.computedScore,
    answers: row.answers,
    accuracy: row.accuracy,
    rank: row.rank
  }));
  const signature = JSON.stringify({
    participantSummaries,
    responseSummaries: buildResponseSummaries(),
    sessionSummary
  });

  if (signature === lastAnalyticsSignature) {
    return;
  }

  try {
    analyticsSyncRunning = true;
    await syncSessionAnalytics({
      sessionId,
      participantSummaries,
      responseSummaries: buildResponseSummaries(),
      sessionSummary
    });
    lastAnalyticsSignature = signature;
  } catch (error) {
    console.error(error);
  } finally {
    analyticsSyncRunning = false;
  }
}

function buildQuestionReview() {
  return questions.map((question, index) => ({
    questionIndex: index,
    question: question.question,
    options: question.options || [],
    correctAnswer: Number(question.correctAnswer || 0),
    stats: buildQuestionStats(index)
  }));
}
