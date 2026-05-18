import { isFirebaseConfigured } from "../config/firebase.js";
import {
  getRemainingSeconds,
  joinLiveSession,
  listenParticipant,
  listenParticipants,
  listenSession,
  normalizeCode,
  submitLiveAnswer
} from "./live.js";
import { isLiveSoundEnabled, playLiveFeedback, setLiveSoundEnabled } from "./sounds.js";
import { applyStoredTheme, bindThemeToggle } from "./theme.js";
import { escapeHTML, setButtonLoading, setTextContent, showToast } from "./ui.js";

let activeSessionId = "";
let participantId = "";
let participantKey = "";
let participant = null;
let currentSession = null;
let directSessionCode = "";
let answeredQuestions = new Map();
let lastRevealKey = "";
let timerIntervalId = null;
let unsubscribeSession = null;
let unsubscribeParticipant = null;
let unsubscribeParticipants = null;
const knownParticipants = new Map();

document.addEventListener("DOMContentLoaded", () => {
  applyStoredTheme();
  bindThemeToggle();
  revealConfigWarnings();
  hydrateDirectSessionLink();
  bindJoinForm();
  bindJoinSoundToggle();
  startTimerLoop();
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(timerIntervalId);
  unsubscribeSession?.();
  unsubscribeParticipant?.();
  unsubscribeParticipants?.();
});

function revealConfigWarnings() {
  if (isFirebaseConfigured) {
    return;
  }

  document.querySelectorAll("[data-config-warning]").forEach((element) => {
    element.hidden = false;
  });
}

function getErrorMessage(error, fallback = "Something went wrong.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

function hydrateDirectSessionLink() {
  directSessionCode = normalizeCode(new URLSearchParams(window.location.search).get("session") || "");

  if (!directSessionCode) {
    return;
  }

  document.querySelector("#join-code").value = directSessionCode;
  document.querySelector("#code-field")?.classList.add("is-hidden");
  setTextContent("#join-title", "Enter your name");
  setTextContent("#join-copy", "You opened a direct classroom link. Add your name and you will join the session.");
  document.querySelector("#join-name")?.focus();
}

function bindJoinSoundToggle() {
  const input = document.querySelector("#join-sound-toggle");
  if (!input) {
    return;
  }

  input.checked = isLiveSoundEnabled();
  input.addEventListener("change", () => {
    setLiveSoundEnabled(input.checked);
    showToast(input.checked ? "Sounds on for this device." : "Sounds muted.", "info");
  });
}

function bindJoinForm() {
  const form = document.querySelector("#join-form");
  const submitButton = document.querySelector("#join-submit");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const code = directSessionCode || normalizeCode(document.querySelector("#join-code").value);
    const name = document.querySelector("#join-name").value.trim();

    if (!code || !name) {
      showToast(directSessionCode ? "Enter your name to join." : "Enter the session code and your name.", "warning");
      return;
    }

    try {
      setButtonLoading(submitButton, true, "Joining...");
      const joinResult = await joinLiveSession({ code, name });
      enterWaitingRoom(joinResult, name);
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to join this live quiz."), "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

function enterWaitingRoom(joinResult, displayName) {
  unsubscribeSession?.();
  unsubscribeParticipant?.();
  unsubscribeParticipants?.();
  knownParticipants.clear();

  activeSessionId = joinResult.session.id;
  participantId = joinResult.participantId;
  participantKey = joinResult.participantKey;
  currentSession = joinResult.session;

  setTextContent("#joined-name", displayName);
  setTextContent("#joined-code", joinResult.session.code || "------");
  showPanel("room-panel");

  unsubscribeSession = listenSession(
    activeSessionId,
    (session) => {
      currentSession = session;
      renderSessionState();
    },
    (error) => showToast(getErrorMessage(error, "Live quiz listener stopped."), "error")
  );

  unsubscribeParticipant = listenParticipant(
    activeSessionId,
    participantId,
    (nextParticipant) => {
      participant = nextParticipant;
      hydrateAnsweredQuestions();
      renderSessionState();
    },
    (error) => showToast(getErrorMessage(error, "Score listener stopped."), "error")
  );

  unsubscribeParticipants = listenParticipants(
    activeSessionId,
    (participants) => {
      renderParticipantAvatars(participants);
    },
    (error) => showToast(getErrorMessage(error, "Participants listener stopped."), "error")
  );
}

function hydrateAnsweredQuestions() {
  Object.entries(participant?.answers || {}).forEach(([questionIndex, answer]) => {
    if (Number.isInteger(answer.selectedOption)) {
      answeredQuestions.set(Number(questionIndex), Number(answer.selectedOption));
    }
  });
}

function getRevealCorrectIndex() {
  if (!currentSession?.questionClosed) {
    return null;
  }

  const value = Number(currentSession.revealedCorrectAnswer);
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
}

function renderSessionState() {
  if (!currentSession) {
    return;
  }

  const status = currentSession.status || "waiting";
  setTextContent("#student-session-status", status);
  setTextContent("#joined-participants", String(Number(currentSession.participantCount || 0)));

  if (status === "waiting") {
    showPanel("room-panel");
    setTextContent("#waiting-copy", "You are in. The teacher will start the quiz soon.");
    return;
  }

  if (status === "ended") {
    renderFinalResult();
    return;
  }

  renderLiveQuestion();
}

function renderParticipantAvatars(participants) {
  const container = document.querySelector("#participant-avatars");
  if (!container) {
    return;
  }

  const currentIds = new Set();
  const newParticipants = [];

  participants.forEach((p) => {
    currentIds.add(p.id);
    if (!knownParticipants.has(p.id)) {
      knownParticipants.set(p.id, p);
      newParticipants.push(p);
    }
  });

  // Remove participants who left
  knownParticipants.forEach((_, id) => {
    if (!currentIds.has(id)) {
      knownParticipants.delete(id);
    }
  });

  container.innerHTML = Array.from(knownParticipants.values())
    .map((p) => {
      const initials = getInitials(p.name || "Player");
      const isNew = newParticipants.some((np) => np.id === p.id);
      return `<div class="participant-avatar ${isNew ? "participant-avatar-new" : ""}" title="${escapeHTML(
        p.name || "Player"
      )}" aria-label="${escapeHTML(p.name || "Player")}">${escapeHTML(initials)}</div>`;
    })
    .join("");
}

function getInitials(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  }
  return (name || "P").toUpperCase().slice(0, 2);
}

function startTimerLoop() {
  window.clearInterval(timerIntervalId);
  timerIntervalId = window.setInterval(() => {
    updateStudentTimer();
  }, 500);
}

function updateStudentTimer() {
  if (!currentSession || currentSession.status !== "live") {
    return;
  }

  const remainingSeconds = getRemainingSeconds(currentSession);
  const timer = Math.max(1, Number(currentSession.timer || 30));
  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / timer) * 100));

  setTextContent("#student-timer", `${remainingSeconds}s`);
  const bar = document.querySelector("#student-timer-bar");
  const timerPill = document.querySelector("#student-timer");

  if (bar) {
    bar.style.width = `${progressPercent}%`;
  }

  if (timerPill) {
    timerPill.classList.toggle(
      "timer-urgent",
      !currentSession.questionClosed && remainingSeconds <= 5 && remainingSeconds > 0
    );
  }

  if (currentSession.questionClosed) {
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.disabled = true;
    });
  } else if (remainingSeconds <= 0) {
    setTextContent("#student-answer-status", "Time is up. Answers are locked.");
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.disabled = true;
    });
  }
}

function renderLiveQuestion() {
  const questionIndex = Number(currentSession.currentQuestion || 0);
  const questionPayload = currentSession.currentQuestionPayload;

  showPanel("quiz-panel");
  setTextContent("#student-question-count", `Question ${questionIndex + 1}`);
  renderStudentLeaderboard();
  updateStudentTimer();

  if (!questionPayload) {
    setTextContent("#student-question-text", "Waiting for the teacher to send the next question.");
    document.querySelector("#student-options").innerHTML = "";
    return;
  }

  const selectedAnswer = answeredQuestions.get(questionIndex);
  const answerRecord = participant?.answers?.[String(questionIndex)];
  const timeUp = getRemainingSeconds(currentSession) <= 0;
  const isLocked = selectedAnswer !== undefined || currentSession.questionClosed || timeUp;
  const revealIndex = getRevealCorrectIndex();

  if (!currentSession.questionClosed) {
    lastRevealKey = "";
  }

  setTextContent("#student-question-text", questionPayload.question || "Question unavailable.");

  if (currentSession.questionClosed) {
    setTextContent("#student-answer-status", "Review: correct answer is highlighted.");
  } else if (selectedAnswer !== undefined) {
    setTextContent("#student-answer-status", "Answer locked. Wait for everyone to finish.");
  } else if (timeUp) {
    setTextContent("#student-answer-status", "Time is up. Hold tight for the reveal.");
  } else {
    setTextContent("#student-answer-status", "Choose one answer before the timer ends.");
  }

  document.querySelector("#student-options").innerHTML = (questionPayload.options || [])
    .map((option, optionIndex) => {
      const isSelected = selectedAnswer === optionIndex;
      const classes = ["option-button", "option-animate"];

      if (isSelected) {
        classes.push("selected");
      }

      if (currentSession.questionClosed && revealIndex !== null) {
        if (optionIndex === revealIndex) {
          classes.push("correct", "reveal-pop");
        } else if (isSelected && optionIndex !== revealIndex) {
          classes.push("incorrect", "reveal-pop");
        }
      }

      return `
        <button class="${classes.join(" ")}" type="button" data-answer="${optionIndex}" ${isLocked ? "disabled" : ""}>
          <span class="option-key">${String.fromCharCode(65 + optionIndex)}</span>
          <span class="option-label">${escapeHTML(option)}</span>
          ${
            currentSession.questionClosed && revealIndex !== null && optionIndex === revealIndex
              ? '<span class="option-result-tag" aria-hidden="true">Correct</span>'
              : ""
          }
          ${
            currentSession.questionClosed && revealIndex !== null && isSelected && optionIndex !== revealIndex
              ? '<span class="option-result-tag bad" aria-hidden="true">Incorrect</span>'
              : ""
          }
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => submitAnswer(questionIndex, Number(button.dataset.answer), button));
  });

  paintLiveRevealStatus(answerRecord, isLocked);
}

function paintLiveRevealStatus(answerRecord, isLocked) {
  const target = document.querySelector("#student-reveal-status");
  if (!target) {
    return;
  }

  target.className = "feedback-copy";
  target.textContent = "";

  if (!isLocked || !currentSession?.questionClosed) {
    return;
  }

  if (!answerRecord || !Number.isInteger(answerRecord.selectedOption)) {
    target.className = "feedback-copy warning";
    target.textContent = "Time up - no answer submitted.";
    playFeedbackToneOnce(false);
    return;
  }

  if (answerRecord.isCorrect) {
    target.className = "feedback-copy success";
    target.textContent = "Correct - great job.";
    playFeedbackToneOnce(true);
    return;
  }

  target.className = "feedback-copy error";
  target.textContent = "Incorrect - check the highlighted answers.";
  playFeedbackToneOnce(false);
}

function playFeedbackToneOnce(isCorrect) {
  const questionIndex = Number(currentSession?.currentQuestion || 0);
  const key = `${questionIndex}_${isCorrect ? "correct" : "wrong"}`;
  if (lastRevealKey === key) {
    return;
  }
  lastRevealKey = key;
  playLiveFeedback(isCorrect);
}

function renderStudentLeaderboard() {
  const container = document.querySelector("#student-live-leaderboard");

  if (!container) {
    return;
  }

  const rows = Array.isArray(currentSession?.publicLeaderboard) ? currentSession.publicLeaderboard : [];

  if (!rows.length) {
    container.innerHTML = '<p class="muted-copy">Leaderboard appears after the first answers are scored.</p>';
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
          (row, index) => {
            const isTop = Number(row.rank) === 1;
            const previousScore = previousScores.get(index);
            const scoreIncreased = previousScore !== undefined && Number(row.score || 0) > previousScore;
            const scoreClass = scoreIncreased ? 'score-increase' : '';
            return `
            <li class="leaderboard-item live-lb-row ${isTop ? "lb-top" : ""}" style="--lb-i:${index}">
              <span class="leaderboard-rank">${Number(row.rank || 0) || "-"}</span>
              <div>
                <div class="leaderboard-name">${escapeHTML(row.name || "Player")}</div>
                <div class="leaderboard-meta">${Number(row.accuracy || 0)}% accuracy</div>
              </div>
              <div class="leaderboard-score">
                <strong class="lb-score ${scoreClass}">${Number(row.score || 0)}</strong>
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

async function submitAnswer(questionIndex, selectedOption, button) {
  if (answeredQuestions.has(questionIndex) || currentSession?.questionClosed || getRemainingSeconds(currentSession) <= 0) {
    return;
  }

  try {
    setButtonLoading(button, true, "Saving...");
    await submitLiveAnswer({
      sessionId: activeSessionId,
      participantId,
      participantKey,
      questionIndex,
      selectedOption
    });

    answeredQuestions.set(questionIndex, selectedOption);
    renderLiveQuestion();
  } catch (error) {
    showToast(getErrorMessage(error, "This answer could not be saved."), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderFinalResult() {
  showPanel("result-panel");

  const answers = participant?.answers || {};
  const review = Array.isArray(currentSession?.questionReview) ? currentSession.questionReview : [];
  const totalQuestions = review.length || Object.keys(answers).length;
  const correctAnswers = Object.values(answers).filter((answer) => answer.isCorrect).length;
  const wrongAnswers = Object.values(answers).filter(
    (answer) => Number.isInteger(answer.selectedOption) && !answer.isCorrect
  ).length;
  const accuracy = Number(participant?.accuracy || (totalQuestions ? Math.round((correctAnswers / totalQuestions) * 100) : 0));
  const lb = Array.isArray(currentSession?.publicLeaderboard) ? currentSession.publicLeaderboard : [];
  const totalPlayers = lb.length || Number(currentSession?.participantCount || 0);
  const rankLabel =
    participant?.rank && totalPlayers
      ? `#${participant.rank} of ${totalPlayers}`
      : participant?.rank
        ? `#${participant.rank}`
        : "-";

  setTextContent("#final-score", String(Number(participant?.score || correctAnswers || 0)));
  setTextContent("#final-name", participant?.name || "Player");
  setTextContent("#final-correct", String(correctAnswers));
  setTextContent("#final-wrong", String(wrongAnswers));
  setTextContent("#final-accuracy", `${accuracy}%`);
  setTextContent("#final-rank", rankLabel);
  renderStudentReview(review, answers);
}

function renderStudentReview(review, answers) {
  const container = document.querySelector("#student-review-list");

  if (!container) {
    return;
  }

  if (!review.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Review is syncing</h3>
        <p>Your teacher's final review data will appear here shortly.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = review
    .map((item, index) => {
      const answer = answers[String(index)] || {};
      const selectedOption = Number.isInteger(answer.selectedOption) ? answer.selectedOption : null;
      const selectedLabel = selectedOption === null ? "No answer" : item.options?.[selectedOption] || "Unknown";
      const correctLabel = item.options?.[Number(item.correctAnswer)] || "Unknown";
      const isCorrect = Boolean(answer.isCorrect);

      return `
        <article class="answer-card ${isCorrect ? "correct" : selectedOption === null ? "unanswered" : "incorrect"}">
          <div class="answer-card-header">
            <h3>Question ${index + 1}</h3>
            <span class="answer-status">${isCorrect ? "Correct" : selectedOption === null ? "No Answer" : "Wrong"}</span>
          </div>
          <p>${escapeHTML(item.question || "Question unavailable.")}</p>
          <div class="answer-meta">
            <span>Your answer: ${escapeHTML(selectedLabel)}</span>
            <span>Correct answer: ${escapeHTML(correctLabel)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function showPanel(panelId) {
  document.querySelectorAll("[data-join-panel]").forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });
}
