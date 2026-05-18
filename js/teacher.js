import { isFirebaseConfigured } from "../config/firebase.js";
import { requireAuth, signOutCurrentUser } from "./auth.js";
import {
  deleteTeacherQuizById,
  getTeacherQuestionsByQuizId,
  getTeacherQuizzes,
  getUserSettings,
  saveTeacherQuizWithQuestions,
  updateTeacherQuizWithQuestions
} from "./db.js";
import { createSession, getSessionParticipants, getSessionResponses, getTeacherSessions } from "./live.js";
import { applyStoredTheme, bindThemeToggle } from "./theme.js";
import {
  collectQuestionDrafts,
  createQuestionDraft,
  escapeHTML,
  renderPageMessage,
  renderQuestionBuilder,
  setButtonLoading,
  setTextContent,
  showToast
} from "./ui.js";

let teacherProfile = null;
let teacherQuizzes = [];
let hostedSessions = [];
let defaultQuestionTimerSeconds = 30;
let builderState = [createQuestionDraft(), createQuestionDraft()];
let editingQuizId = "";
let quizSearchTerm = "";
let quizSortMode = "newest";

document.addEventListener("DOMContentLoaded", () => {
  initTeacherDashboard().catch((error) => {
    console.error(error);
    showToast(getErrorMessage(error, "Teacher dashboard could not load."), "error");
  });
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

function blockTeacherPage(message) {
  renderPageMessage(document.querySelector("main"), {
    title: "Firebase setup required",
    description: message,
    actions: [
      { label: "Open Login", href: "./login.html", variant: "btn-secondary" },
      { label: "Back Home", href: "./index.html", variant: "btn-ghost" }
    ]
  });
}

async function initTeacherDashboard() {
  applyStoredTheme();
  bindThemeToggle();
  const session = await requireAuth({ allowedRoles: ["teacher"] });

  if (!session) {
    if (!isFirebaseConfigured) {
      blockTeacherPage("Update config/firebase.js before using the teacher live quiz dashboard.");
    }
    return;
  }

  teacherProfile = session.profile;
  try {
    const userSettings = await getUserSettings(teacherProfile.uid);
    defaultQuestionTimerSeconds = Math.min(120, Math.max(5, Number(userSettings.defaultTimer || 30)));
  } catch {
    defaultQuestionTimerSeconds = 30;
  }

  attachLogout(document.querySelector("#logout-button"));
  setTextContent("#teacher-user-chip", teacherProfile.name || teacherProfile.email || "Teacher");
  setTextContent("#teacher-name", firstName(teacherProfile.name || teacherProfile.email || "Teacher"));

  bindBuilderControls();
  bindDiscoveryControls();
  drawBuilder();
  await refreshTeacherData();
}

function bindDiscoveryControls() {
  document.querySelector("#teacher-quiz-search")?.addEventListener("input", (event) => {
    quizSearchTerm = String(event.target.value || "").trim().toLowerCase();
    renderTeacherQuizzes();
  });

  document.querySelector("#teacher-quiz-sort")?.addEventListener("change", (event) => {
    quizSortMode = String(event.target.value || "newest");
    renderTeacherQuizzes();
  });
}

function bindBuilderControls() {
  const form = document.querySelector("#teacher-quiz-form");
  const questionBuilder = document.querySelector("#teacher-question-builder");

  questionBuilder?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove-question"]');

    if (!button) {
      return;
    }

    syncBuilder();
    builderState.splice(Number(button.dataset.index), 1);

    if (!builderState.length) {
      builderState = [createQuestionDraft()];
    }

    drawBuilder();
  });

  document.querySelector("#teacher-add-question")?.addEventListener("click", () => {
    syncBuilder();
    builderState.push(createQuestionDraft({ timerSeconds: defaultQuestionTimerSeconds }));
    drawBuilder();
  });

  document.querySelector("#teacher-clear-form")?.addEventListener("click", () => {
    resetBuilder();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveTeacherQuiz();
  });
}

function syncBuilder() {
  const questionBuilder = document.querySelector("#teacher-question-builder");
  const drafts = collectQuestionDrafts(questionBuilder);
  builderState = drafts.length ? drafts : [createQuestionDraft()];
}

function drawBuilder() {
  renderQuestionBuilder(document.querySelector("#teacher-question-builder"), builderState);
}

function resetBuilder() {
  const saveButton = document.querySelector("#teacher-save-quiz");

  editingQuizId = "";
  builderState = [
    createQuestionDraft({ timerSeconds: defaultQuestionTimerSeconds }),
    createQuestionDraft({ timerSeconds: defaultQuestionTimerSeconds })
  ];
  document.querySelector("#teacher-quiz-form")?.reset();
  delete saveButton?.dataset.originalLabel;
  setTextContent("#teacher-form-title", "Create a private quiz");
  setTextContent(saveButton, "Save Teacher Quiz");
  drawBuilder();
}

function getValidatedQuestionDrafts() {
  syncBuilder();

  const hasInvalidQuestion = builderState.some((question) => {
    const options = Array.isArray(question.options) ? question.options : [];
    return !question.prompt || options.length !== 4 || options.some((option) => !option.trim());
  });

  if (hasInvalidQuestion) {
    throw new Error("Every question needs a prompt and four answer options.");
  }

  return builderState;
}

async function saveTeacherQuiz() {
  const saveButton = document.querySelector("#teacher-save-quiz");
  const title = document.querySelector("#teacher-quiz-title").value.trim();

  if (!title) {
    showToast("Add a quiz title first.", "warning");
    return;
  }

  try {
    const questions = getValidatedQuestionDrafts();
    setButtonLoading(saveButton, true, editingQuizId ? "Updating..." : "Saving...");

    if (editingQuizId) {
      await updateTeacherQuizWithQuestions({
        quizId: editingQuizId,
        quiz: { title },
        questions,
        teacherId: teacherProfile.uid
      });
      showToast("Teacher quiz updated.", "success");
    } else {
      await saveTeacherQuizWithQuestions({
        quiz: { title },
        questions,
        teacher: teacherProfile
      });
      showToast("Teacher quiz saved privately.", "success");
    }

    resetBuilder();
    await refreshTeacherData();
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to save this teacher quiz."), "error");
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function refreshTeacherData() {
  try {
    const [quizzes, sessions] = await Promise.all([
      getTeacherQuizzes(teacherProfile.uid),
      getTeacherSessions(teacherProfile.uid)
    ]);

    teacherQuizzes = quizzes;
    hostedSessions = sessions;

    setTextContent("#teacher-quiz-count", String(teacherQuizzes.length));
    setTextContent("#teacher-session-count", String(hostedSessions.length));
    setTextContent(
      "#teacher-live-count",
      String(hostedSessions.filter((session) => session.status === "waiting" || session.status === "live").length)
    );
    setTextContent(
      "#teacher-summary",
      teacherQuizzes.length
        ? `${teacherQuizzes.length} private quiz set${teacherQuizzes.length === 1 ? "" : "s"} ready for live sessions.`
        : "Create your first private quiz to start hosting live rounds."
    );
    setTextContent("#teacher-top-score", String(getTopSessionScore(hostedSessions)));

    renderTeacherQuizzes();
    renderHostedSessions();
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to refresh teacher data."), "error");
  }
}

function getTopSessionScore(sessions) {
  return sessions.reduce((bestScore, session) => {
    const sessionBest = Array.isArray(session.publicLeaderboard)
      ? session.publicLeaderboard.reduce((best, row) => Math.max(best, Number(row.score || 0)), 0)
      : 0;

    return Math.max(bestScore, sessionBest);
  }, 0);
}

function renderTeacherQuizzes() {
  const container = document.querySelector("#teacher-quiz-list");

  if (!container) {
    return;
  }

  if (!teacherQuizzes.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No private quizzes yet</h3>
        <p>Create a quiz here. It will stay out of the global admin catalog.</p>
      </div>
    `;
    return;
  }

  const visibleQuizzes = getVisibleTeacherQuizzes();

  if (!visibleQuizzes.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No quizzes match this filter</h3>
        <p>Try a different search term or sort mode.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = visibleQuizzes
    .map(
      (quiz) => `
        <article class="management-card">
          <div class="management-header">
            <div>
              <h3>${escapeHTML(quiz.title)}</h3>
              <p>${Number(quiz.questionCount || 0)} question${Number(quiz.questionCount || 0) === 1 ? "" : "s"}</p>
            </div>
            <span class="status-badge status-private">Private</span>
          </div>

          <div class="management-footer">
            <span class="muted-copy">Only visible in your teacher dashboard</span>
            <div class="hero-actions">
              <button class="btn btn-primary" type="button" data-action="start-live" data-quiz-id="${escapeHTML(
                quiz.id
              )}">Start Live</button>
              <button class="btn btn-secondary" type="button" data-action="edit-quiz" data-quiz-id="${escapeHTML(
                quiz.id
              )}">Edit</button>
              <button class="btn btn-ghost" type="button" data-action="delete-quiz" data-quiz-id="${escapeHTML(
                quiz.id
              )}">Delete</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  container.querySelectorAll("[data-action='start-live']").forEach((button) => {
    button.addEventListener("click", () => startLiveQuiz(button.dataset.quizId, button));
  });

  container.querySelectorAll("[data-action='edit-quiz']").forEach((button) => {
    button.addEventListener("click", () => loadQuizForEditing(button.dataset.quizId));
  });

  container.querySelectorAll("[data-action='delete-quiz']").forEach((button) => {
    button.addEventListener("click", () => deleteTeacherQuiz(button.dataset.quizId));
  });
}

function getVisibleTeacherQuizzes() {
  const filtered = teacherQuizzes.filter((quiz) =>
    (quiz.title || "").toLowerCase().includes(quizSearchTerm)
  );
  const next = [...filtered];

  next.sort((left, right) => {
    if (quizSortMode === "title-asc") {
      return String(left.title || "").localeCompare(String(right.title || ""));
    }

    if (quizSortMode === "title-desc") {
      return String(right.title || "").localeCompare(String(left.title || ""));
    }

    if (quizSortMode === "questions-desc") {
      return Number(right.questionCount || 0) - Number(left.questionCount || 0);
    }

    const leftTime = left.createdAt?.seconds || 0;
    const rightTime = right.createdAt?.seconds || 0;
    return quizSortMode === "oldest" ? leftTime - rightTime : rightTime - leftTime;
  });

  return next;
}

async function startLiveQuiz(quizId, button) {
  const quiz = teacherQuizzes.find((item) => item.id === quizId);

  if (!quiz) {
    showToast("Selected quiz could not be found.", "warning");
    return;
  }

  try {
    setButtonLoading(button, true, "Starting...");
    const questions = await getTeacherQuestionsByQuizId(quizId);

    if (!questions.length) {
      throw new Error("Add at least one question before starting a live quiz.");
    }

    const { sessionId } = await createSession({
      quizId,
      teacherId: teacherProfile.uid
    });

    window.location.assign(`./teacher-live.html?sessionId=${encodeURIComponent(sessionId)}`);
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to start a live quiz."), "error");
    setButtonLoading(button, false);
  }
}

async function loadQuizForEditing(quizId) {
  const quiz = teacherQuizzes.find((item) => item.id === quizId);

  if (!quiz) {
    showToast("Selected quiz could not be found.", "warning");
    return;
  }

  try {
    const questions = await getTeacherQuestionsByQuizId(quizId);
    editingQuizId = quizId;
    document.querySelector("#teacher-quiz-title").value = quiz.title || "";
    builderState = questions.length
      ? questions.map((question) =>
          createQuestionDraft({
            prompt: question.question,
            options: question.options,
            correctAnswer: question.correctAnswer,
            timerSeconds: question.timer ?? question.timerSeconds
          })
        )
      : [createQuestionDraft()];

    setTextContent("#teacher-form-title", "Edit private quiz");
    setTextContent("#teacher-save-quiz", "Update Teacher Quiz");
    drawBuilder();
    document.querySelector("#teacher-quiz-title")?.focus();
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to load quiz for editing."), "error");
  }
}

async function deleteTeacherQuiz(quizId) {
  const quiz = teacherQuizzes.find((item) => item.id === quizId);

  if (!quiz) {
    showToast("Selected quiz could not be found.", "warning");
    return;
  }

  if (!window.confirm(`Delete "${quiz.title}" and its teacher questions?`)) {
    return;
  }

  try {
    await deleteTeacherQuizById({ quizId, teacherId: teacherProfile.uid });
    if (editingQuizId === quizId) {
      resetBuilder();
    }
    await refreshTeacherData();
    showToast("Teacher quiz deleted.", "success");
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to delete this teacher quiz."), "error");
  }
}

function renderHostedSessions() {
  const container = document.querySelector("#teacher-session-list");

  if (!container) {
    return;
  }

  if (!hostedSessions.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No hosted sessions yet</h3>
        <p>Start a live quiz and your session history will appear here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = hostedSessions
    .map((session) => {
      const quiz = teacherQuizzes.find((item) => item.id === session.quizId);
      const canReopen = session.status !== "ended";

      return `
        <article class="session-row">
          <div>
            <strong>${escapeHTML(quiz?.title || "Teacher quiz")}</strong>
            <span>
              Code ${escapeHTML(session.code || "------")} | ${Number(session.participantCount || 0)} participants | ${formatDate(
                session.createdAt
              )}
            </span>
          </div>
          <div class="hero-actions">
            <span class="status-badge status-${escapeHTML(session.status || "waiting")}">${escapeHTML(
              session.status || "waiting"
            )}</span>
            ${
              session.status === "ended"
                ? `<button class="btn btn-secondary" type="button" data-action="view-analytics" data-session-id="${escapeHTML(
                    session.id
                  )}">View Analytics</button>`
                : ""
            }
            ${
              canReopen
                ? `<a class="btn btn-secondary" href="./teacher-live.html?sessionId=${encodeURIComponent(
                    session.id
                  )}">Reopen</a>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-action='view-analytics']").forEach((button) => {
    button.addEventListener("click", () => loadSessionAnalytics(button.dataset.sessionId, button));
  });
}

async function loadSessionAnalytics(sessionId, button) {
  const session = hostedSessions.find((item) => item.id === sessionId);
  const container = document.querySelector("#teacher-analytics-panel");

  if (!session || !container) {
    showToast("Selected session could not be found.", "warning");
    return;
  }

  try {
    setButtonLoading(button, true, "Loading...");
    const [participants, responses, questions] = await Promise.all([
      getSessionParticipants(sessionId),
      getSessionResponses(sessionId),
      getTeacherQuestionsByQuizId(session.quizId)
    ]);

    renderSessionAnalytics(container, { session, participants, responses, questions });
    document.querySelector("#teacher-analytics-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showToast(getErrorMessage(error, "Unable to load session analytics."), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderSessionAnalytics(container, { session, participants, responses, questions }) {
  const review = Array.isArray(session.questionReview) && session.questionReview.length
    ? session.questionReview
    : questions.map((question, index) => ({
        questionIndex: index,
        question: question.question,
        options: question.options,
        correctAnswer: Number(question.correctAnswer || 0)
      }));
  const rows = buildAnalyticsRows({ participants, responses, review });
  const topScorers = rows.slice(0, 3);
  const answeredSlots = rows.reduce((sum, row) => sum + row.answeredCount, 0);
  const possibleSlots = Math.max(1, participants.length * Math.max(1, review.length));
  const participationRate = Math.round((answeredSlots / possibleSlots) * 100);
  const leaderboardHistory = session.leaderboardHistory || {};

  container.innerHTML = `
    <div class="analytics-summary-grid">
      <article>
        <span>Participants</span>
        <strong>${participants.length}</strong>
      </article>
      <article>
        <span>Participation</span>
        <strong>${participationRate}%</strong>
      </article>
      <article>
        <span>Top Score</span>
        <strong>${topScorers[0]?.score || 0}</strong>
      </article>
      <article>
        <span>Questions</span>
        <strong>${review.length}</strong>
      </article>
    </div>

    <div class="analytics-columns">
      <section>
        <h3>Top scorers</h3>
        <div class="mini-analytics-list">
          ${
            topScorers.length
              ? topScorers
                  .map(
                    (row) => `
                      <article>
                        <strong>#${row.rank} ${escapeHTML(row.name)}</strong>
                        <span>${row.score} pts | ${row.accuracy}% accuracy</span>
                      </article>
                    `
                  )
                  .join("")
              : '<p class="muted-copy">No scores recorded.</p>'
          }
        </div>
      </section>

      <section>
        <h3>Leaderboard history</h3>
        <div class="mini-analytics-list">
          ${renderLeaderboardHistory(leaderboardHistory)}
        </div>
      </section>
    </div>

    <div class="table-shell">
      <table class="data-table analytics-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Score</th>
            <th>Accuracy</th>
            <th>Answers</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHTML(row.name)}</td>
                  <td>${row.score}</td>
                  <td>${row.accuracy}%</td>
                  <td>${row.answerSummary}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildAnalyticsRows({ participants, responses, review }) {
  const responseMap = new Map(
    responses.map((response) => [`${response.participantId}_${Number(response.questionIndex)}`, response])
  );

  const rows = participants.map((participant) => {
    let score = Number(participant.score || 0);
    let answeredCount = 0;
    const answerSummary = review
      .map((question, index) => {
        const storedAnswer = participant.answers?.[String(index)];
        const response = responseMap.get(`${participant.id}_${index}`);
        const selectedOption = Number.isInteger(storedAnswer?.selectedOption)
          ? storedAnswer.selectedOption
          : response
            ? Number(response.selectedOption ?? response.answer)
            : null;
        const isAnswered = Number.isInteger(selectedOption);
        const isCorrect = isAnswered && selectedOption === Number(question.correctAnswer);

        if (isAnswered) {
          answeredCount += 1;
        }

        return `
          <span class="answer-chip ${isCorrect ? "correct" : isAnswered ? "incorrect" : "unanswered"}">
            Q${index + 1}: ${isAnswered ? String.fromCharCode(65 + selectedOption) : "-"}
          </span>
        `;
      })
      .join("");

    if (!score) {
      score = (participant.answers ? Object.values(participant.answers) : []).filter((answer) => answer.isCorrect).length;
    }

    return {
      id: participant.id,
      name: participant.name || "Guest",
      score,
      accuracy: Number(participant.accuracy || (review.length ? Math.round((score / review.length) * 100) : 0)),
      answeredCount,
      answerSummary
    };
  });

  rows.sort((left, right) => right.score - left.score || right.accuracy - left.accuracy);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows;
}

function renderLeaderboardHistory(history) {
  const entries = Object.entries(history || {});

  if (!entries.length) {
    return '<p class="muted-copy">No leaderboard snapshots recorded yet.</p>';
  }

  return entries
    .map(([questionIndex, rows]) => {
      const leaders = Array.isArray(rows)
        ? rows
            .slice(0, 3)
            .map((row) => `${escapeHTML(row.name || "Player")} (${Number(row.score || 0)})`)
            .join(", ")
        : "No entries";

      return `
        <article>
          <strong>After Q${Number(questionIndex) + 1}</strong>
          <span>${leaders}</span>
        </article>
      `;
    })
    .join("");
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Just now";
  }

  const date = timestamp.toDate ? timestamp.toDate() : new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? "Just now" : date.toLocaleString();
}

function firstName(value) {
  return (
    String(value || "")
      .trim()
      .split(" ")
      .filter(Boolean)[0] || "Teacher"
  );
}
