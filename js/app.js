import { isFirebaseConfigured } from "../config/firebase.js";
import {
  getRoleHome,
  redirectIfAuthenticated,
  requireAuth,
  resolveSessionUser,
  signInWithEmailPassword,
  signOutCurrentUser,
  signUpWithEmailPassword
} from "./auth.js";
import {
  deleteQuizById,
  getAllQuizzes,
  getAllUsers,
  getAvailableQuizzes,
  getLeaderboardEntries,
  getQuestionsByQuizId,
  getQuizById,
  getUserAttemptStats,
  getUserSettings,
  saveAttemptRecord,
  saveQuizWithQuestions,
  seedDemoQuiz,
  updateQuizMeta
} from "./db.js";
import { getPerformanceMessage, QuizEngine } from "./quiz.js";
import { applyStoredTheme, bindThemeToggle, persistTheme } from "./theme.js";
import {
  clearQuizSettingsForm,
  collectQuestionDrafts,
  createQuestionDraft,
  populateQuizSettingsForm,
  renderCategoryChips,
  renderLeaderboard,
  renderPageMessage,
  renderQuestionBuilder,
  renderQuizCatalog,
  renderQuizManagement,
  renderQuizOptions,
  renderResultBreakdown,
  renderUsersTable,
  revealQuizAnswer,
  setButtonLoading,
  setTextContent,
  showToast
} from "./ui.js";
const RESULT_STORAGE_KEY = "quixxy:last-result";
const QUIZ_FEEDBACK_DELAY = 1400;

document.addEventListener("DOMContentLoaded", () => {
  applyStoredTheme();
  initThemeToggle();
  initApp().catch((error) => {
    console.error(error);
    showToast(getErrorMessage(error, "The app could not finish loading."), "error");
  });
});

async function initApp() {
  revealConfigWarnings();
  const page = document.body.dataset.page;

  switch (page) {
    case "index":
      await initIndexPage();
      break;
    case "login":
      await initLoginPage();
      break;
    case "signup":
      await initSignupPage();
      break;
    case "dashboard":
      await initDashboardPage();
      break;
    case "quiz":
      await initQuizPage();
      break;
    case "result":
      await initResultPage();
      break;
    case "admin":
      await initAdminPage();
      break;
    default:
      break;
  }
}

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

function blockProtectedPage(message) {
  const main = document.querySelector("main");

  if (!main) {
    return;
  }

  renderPageMessage(main, {
    title: "Firebase setup required",
    description: message,
    actions: [
      { label: "Open Firebase Config", href: "./config/firebase.js", variant: "btn-secondary" },
      { label: "Back to Home", href: "./index.html", variant: "btn-ghost" }
    ]
  });
}

function attachLogout(button) {
  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    try {
      await signOutCurrentUser();
      window.location.assign("./login.html");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to sign out right now."), "error");
    }
  });
}

async function initIndexPage() {
  if (!isFirebaseConfigured) {
    return;
  }

  const session = await resolveSessionUser();

  if (session.user && session.profile) {
    const nav = document.querySelector(".nav-actions");

    if (nav) {
      nav.innerHTML = `
        <a href="${getRoleHome(session.profile.role)}" class="btn btn-primary">Continue</a>
      `;
    }
  }
}

async function initLoginPage() {
  if (await redirectIfAuthenticated()) {
    return;
  }

  const form = document.querySelector("#login-form");
  const submitButton = document.querySelector("#login-submit");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.querySelector("#login-email").value.trim();
    const password = document.querySelector("#login-password").value.trim();

    if (!email || !password) {
      showToast("Enter both your email and password.", "warning");
      return;
    }

    try {
      setButtonLoading(submitButton, true, "Signing in...");
      const { profile } = await signInWithEmailPassword({ email, password });
      showToast("Login successful. Redirecting...", "success");
      window.location.assign(getRoleHome(profile.role));
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to log in."), "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

async function initSignupPage() {
  if (await redirectIfAuthenticated()) {
    return;
  }

  const form = document.querySelector("#signup-form");
  const submitButton = document.querySelector("#signup-submit");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.querySelector("#signup-name").value.trim();
    const email = document.querySelector("#signup-email").value.trim();
    const password = document.querySelector("#signup-password").value;
    const confirmPassword = document.querySelector("#signup-confirm-password").value;
    const role = document.querySelector("#signup-role").value;

    if (!name || !email || !password) {
      showToast("Complete every required field before continuing.", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Passwords do not match.", "warning");
      return;
    }

    try {
      setButtonLoading(submitButton, true, "Creating account...");
      const { profile } = await signUpWithEmailPassword({ name, email, password, role });
      showToast("Account created! Please verify your email.", "success");
      window.location.assign("./login.html");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to create the account."), "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

async function initDashboardPage() {
  const session = await requireAuth({ allowedRoles: ["student", "admin"] });

  if (!session) {
    if (!isFirebaseConfigured) {
      blockProtectedPage("Replace the placeholder Firebase credentials in config/firebase.js, then reload the dashboard.");
    }
    return;
  }

  const { profile } = session;

  attachLogout(document.querySelector("#logout-button"));
  setTextContent("#header-user", profile.name || profile.email || "Quixxy User");
  setTextContent("#dashboard-name", firstName(profile.name || profile.email || "Learner"));
  setTextContent("#dashboard-role", profile.role);

  const manageLink = document.querySelector("#manage-link");

  if (profile.role === "admin") {
    if (manageLink) {
      manageLink.textContent = "Open Admin";
      manageLink.href = "./admin.html";
      manageLink.classList.remove("is-hidden");
    }
  }

  try {
    const [stats, quizzes, leaderboard, userSettings] = await Promise.all([
      getUserAttemptStats(profile.uid),
      getAvailableQuizzes({ includeDrafts: profile.role !== "student" }),
      getLeaderboardEntries(8),
      getUserSettings(profile.uid)
    ]);

    if (userSettings?.theme === "light" || userSettings?.theme === "dark") {
      persistTheme(userSettings.theme);
    }

    const visibleQuizzes =
      profile.role === "student" ? quizzes.filter((quiz) => quiz.status === "published") : quizzes;

    setTextContent("#stat-attempts", String(stats.attemptsCount));
    setTextContent("#stat-average", `${stats.averagePercentage}%`);
    setTextContent("#stat-best", `${stats.bestPercentage}%`);
    setTextContent("#stat-points", String(stats.totalPoints));
    setTextContent(
      "#dashboard-summary",
      stats.attemptsCount
        ? `You have completed ${stats.attemptsCount} quizzes with a best score of ${stats.bestPercentage}%.`
        : "No attempts yet. Start with a published quiz to generate your first result."
    );

    renderCategoryChips(document.querySelector("#category-list"), visibleQuizzes);
    renderQuizCatalog(document.querySelector("#quiz-list"), visibleQuizzes);
    renderLeaderboard(document.querySelector("#leaderboard-list"), leaderboard);
  } catch (error) {
    renderPageMessage(document.querySelector("main"), {
      title: "Dashboard unavailable",
      description: getErrorMessage(error, "Quixxy could not load dashboard data."),
      actions: [{ label: "Refresh Page", href: "./dashboard.html", variant: "btn-secondary" }]
    });
  }
}

async function initQuizPage() {
  const session = await requireAuth({ allowedRoles: ["student", "teacher", "admin"] });

  if (!session) {
    if (!isFirebaseConfigured) {
      blockProtectedPage("Replace the placeholder Firebase credentials in config/firebase.js, then reload the quiz page.");
    }
    return;
  }

  const quizId = new URLSearchParams(window.location.search).get("id");

  if (!quizId) {
    renderPageMessage(document.querySelector("main"), {
      title: "Quiz not selected",
      description: "Open a quiz from the dashboard to start a session.",
      actions: [{ label: "Back to Dashboard", href: "./dashboard.html", variant: "btn-secondary" }]
    });
    return;
  }

  try {
    const [quiz, questions] = await Promise.all([getQuizById(quizId), getQuestionsByQuizId(quizId)]);

    if (!quiz) {
      throw new Error("This quiz could not be found.");
    }

    if (session.profile.role === "student" && quiz.status !== "published") {
      throw new Error("This quiz is not currently published.");
    }

    if (!questions.length) {
      throw new Error("This quiz does not have any questions yet.");
    }

    const engine = new QuizEngine({
      quiz,
      questions,
      timePerQuestion: Number(quiz.durationSeconds || 15)
    });

    setTextContent("#quiz-title", quiz.title);
    setTextContent("#quiz-category", `${quiz.category} | ${quiz.difficulty || "Intermediate"} | ${questions.length} questions`);

    let isTransitioning = false;

    const renderCurrentQuestion = () => {
      const question = engine.getCurrentQuestion();

      setTextContent("#quiz-progress", engine.getProgressLabel());
      setTextContent("#question-index", `Question ${engine.currentIndex + 1}`);
      setTextContent("#question-text", question.prompt);
      document.querySelector("#quiz-progress-bar").style.width = `${engine.getProgressPercent()}%`;
      setTextContent("#question-feedback", "");
      document.querySelector("#question-feedback").className = "feedback-copy";

      renderQuizOptions(document.querySelector("#question-options"), question, async (selectedIndex) => {
        if (isTransitioning) {
          return;
        }

        isTransitioning = true;
        const result = engine.submitAnswer(selectedIndex);

        if (!result) {
          isTransitioning = false;
          return;
        }

        revealQuizAnswer(document.querySelector("#question-options"), result);
        paintFeedback(result.answer);
        await moveToNextStep();
        isTransitioning = false;
      });

      engine.startTimer(
        (secondsLeft) => {
          setTextContent("#quiz-timer", `${Math.max(secondsLeft, 0)}s`);
        },
        async () => {
          if (isTransitioning) {
            return;
          }

          isTransitioning = true;
          const result = engine.submitAnswer(null, { timedOut: true });
          revealQuizAnswer(document.querySelector("#question-options"), result);
          paintFeedback(result.answer);
          await moveToNextStep();
          isTransitioning = false;
        }
      );
    };

    const paintFeedback = (answer) => {
      const feedbackElement = document.querySelector("#question-feedback");
      const stateClass = answer.isCorrect ? "success" : answer.selectedIndex === null ? "warning" : "error";
      feedbackElement.className = `feedback-copy ${stateClass}`;

      if (answer.isCorrect) {
        feedbackElement.textContent = "Correct. Nice work.";
        return;
      }

      if (answer.selectedIndex === null) {
        feedbackElement.textContent = `Time is up. ${answer.explanation || "The correct option has been highlighted."}`;
        return;
      }

      feedbackElement.textContent = `Incorrect. ${answer.explanation || "The correct option has been highlighted for review."}`;
    };

    const moveToNextStep = async () => {
      await delay(QUIZ_FEEDBACK_DELAY);

      if (engine.hasNextQuestion()) {
        engine.moveNext();
        renderCurrentQuestion();
        return;
      }

      engine.clearTimer();
      const resultPayload = engine.buildResult();
      sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(resultPayload));
      window.location.assign("./result.html");
    };

    renderCurrentQuestion();
  } catch (error) {
    renderPageMessage(document.querySelector("main"), {
      title: "Quiz unavailable",
      description: getErrorMessage(error, "Quixxy could not load this quiz."),
      actions: [{ label: "Back to Dashboard", href: "./dashboard.html", variant: "btn-secondary" }]
    });
  }
}

async function initResultPage() {
  const session = await requireAuth({ allowedRoles: ["student", "teacher", "admin"] });

  if (!session) {
    if (!isFirebaseConfigured) {
      blockProtectedPage("Replace the placeholder Firebase credentials in config/firebase.js, then reload the results page.");
    }
    return;
  }

  const payload = readStoredResult();

  if (!payload) {
    renderPageMessage(document.querySelector("main"), {
      title: "No result found",
      description: "Start a quiz from the dashboard to generate a result summary.",
      actions: [{ label: "Browse Quizzes", href: "./dashboard.html", variant: "btn-secondary" }]
    });
    return;
  }

  const { quiz, summary, answers } = payload;

  setTextContent("#result-score", String(summary.score));
  setTextContent("#result-total", String(summary.totalQuestions));
  setTextContent("#result-percentage", `${summary.percentage}%`);
  setTextContent("#result-message", summary.message || getPerformanceMessage(summary.percentage));
  setTextContent("#result-correct", String(summary.correctAnswers));
  setTextContent("#result-incorrect", String(summary.totalQuestions - summary.correctAnswers));

  renderResultBreakdown(document.querySelector("#result-breakdown"), payload);

  const retakeButton = document.querySelector("#retake-quiz-button");
  retakeButton?.addEventListener("click", () => {
    window.location.assign(`./quiz.html?id=${encodeURIComponent(quiz.id)}`);
  });

  const syncStatus = document.querySelector("#result-sync-status");

  if (payload.persisted) {
    setTextContent(syncStatus, "Attempt already saved to Firestore.");
    return;
  }

  try {
    setTextContent(syncStatus, "Saving attempt to Firestore...");
    await saveAttemptRecord({
      quiz,
      summary,
      answers,
      user: {
        uid: session.profile.uid,
        name: session.profile.name,
        email: session.profile.email,
        role: session.profile.role
      }
    });

    payload.persisted = true;
    sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(payload));
    setTextContent(syncStatus, "Attempt saved and leaderboard updated.");
  } catch (error) {
    setTextContent(syncStatus, "Unable to sync this result right now.");
    showToast(getErrorMessage(error, "Result sync failed."), "error");
  }
}

async function initAdminPage() {
  const session = await requireAuth({ allowedRoles: ["admin"] });
  if (!session) {
    if (!isFirebaseConfigured) {
      blockProtectedPage("Replace the placeholder Firebase credentials in config/firebase.js, then reload the studio.");
    }
    return;
  }

  const { profile } = session;
  const isAdmin = profile.role === "admin";
  let managedQuizzes = [];
  let builderState = [createQuestionDraft(), createQuestionDraft()];

  setTextContent("#admin-user-chip", profile.name || profile.email || "Studio");
  setTextContent("#admin-role", profile.role);
  setTextContent("#admin-title", isAdmin ? "Admin Control Room" : "Teacher Studio");
  setTextContent(
    "#admin-subtitle",
    isAdmin
      ? "Oversee users, moderate quiz content, and manage the live catalog."
      : "Create quizzes, manage your content, and keep the catalog fresh."
  );

  if (!isAdmin) {
    document.querySelector("#admin-users-section")?.classList.add("is-hidden");
  }

  attachLogout(document.querySelector("#logout-button"));

  const questionBuilder = document.querySelector("#question-builder");
  const builderForm = document.querySelector("#quiz-builder-form");
  const settingsForm = document.querySelector("#quiz-settings-form");
  const saveQuizButton = document.querySelector("#save-quiz-button");
  const updateQuizButton = document.querySelector("#update-quiz-button");
  const seedDemoButton = document.querySelector("#seed-demo-button");
  const bulkImportForm = document.querySelector("#bulk-import-form");
  const bulkImportFileInput = document.querySelector("#bulk-import-file");
  const bulkImportPreviewButton = document.querySelector("#bulk-import-preview");
  const bulkImportPublishButton = document.querySelector("#bulk-import-publish");
  const bulkImportPreviewPanel = document.querySelector("#bulk-import-preview-panel");
  const bulkDropzone = document.querySelector("#bulk-import-dropzone");
  let bulkImportPayload = [];

  const assignBulkFile = (file) => {
    if (!file || !bulkImportFileInput) {
      return;
    }

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      bulkImportFileInput.files = dataTransfer.files;
    } catch {
      bulkImportFileInput.value = "";
    }
  };

  bulkDropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    bulkDropzone.classList.add("dropzone-active");
  });

  bulkDropzone?.addEventListener("dragleave", () => {
    bulkDropzone.classList.remove("dropzone-active");
  });

  bulkDropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    bulkDropzone.classList.remove("dropzone-active");
    const file = event.dataTransfer?.files?.[0];
    assignBulkFile(file);
    if (file) {
      showToast(`Selected ${file.name}`, "success");
    }
  });

  const syncBuilder = () => {
    const drafts = collectQuestionDrafts(questionBuilder);
    builderState = drafts.length ? drafts : [createQuestionDraft()];
  };

  const drawBuilder = () => {
    renderQuestionBuilder(questionBuilder, builderState);
  };

  const refreshStudioData = async () => {
    const [allQuizzes, allUsers] = await Promise.all([
      getAllQuizzes(),
      isAdmin ? getAllUsers() : Promise.resolve([])
    ]);

    managedQuizzes = isAdmin ? allQuizzes : allQuizzes.filter((quiz) => quiz.createdBy === profile.uid);

    renderQuizManagement(document.querySelector("#admin-quiz-list"), managedQuizzes, {
      onLoad: (quizId) => {
        const selectedQuiz = managedQuizzes.find((quiz) => quiz.id === quizId);

        if (!selectedQuiz) {
          showToast("Selected quiz could not be found.", "warning");
          return;
        }

        populateQuizSettingsForm(settingsForm, selectedQuiz);
        showToast("Quiz loaded into the settings editor.", "info");
      },
      onDelete: async (quizId) => {
        const selectedQuiz = managedQuizzes.find((quiz) => quiz.id === quizId);

        if (!selectedQuiz) {
          showToast("Selected quiz could not be found.", "warning");
          return;
        }

        const confirmed = window.confirm(`Delete "${selectedQuiz.title}" and its questions?`);

        if (!confirmed) {
          return;
        }

        try {
          await deleteQuizById(quizId);
          showToast("Quiz deleted successfully.", "success");
          await refreshStudioData();
        } catch (error) {
          showToast(getErrorMessage(error, "Unable to delete quiz."), "error");
        }
      }
    });

    if (isAdmin) {
      renderUsersTable(document.querySelector("#admin-user-table"), allUsers);
    }
  };

  drawBuilder();
  await refreshStudioData();

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

  document.querySelector("#add-question-button")?.addEventListener("click", () => {
    syncBuilder();
    builderState.push(createQuestionDraft());
    drawBuilder();
  });

  document.querySelector("#clear-builder-button")?.addEventListener("click", () => {
    builderForm.reset();
    builderState = [createQuestionDraft(), createQuestionDraft()];
    drawBuilder();
  });

  document.querySelector("#clear-settings-button")?.addEventListener("click", () => {
    clearQuizSettingsForm(settingsForm);
  });

  builderForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncBuilder();

    const title = document.querySelector("#quiz-title-input").value.trim();
    const category = document.querySelector("#quiz-category-input").value.trim();
    const difficulty = document.querySelector("#quiz-difficulty-input").value;
    const description = document.querySelector("#quiz-description-input").value.trim();
    const durationSeconds = Number(document.querySelector("#quiz-duration-input").value || 15);

    if (!title || !category || !description) {
      showToast("Complete the quiz title, category, and description.", "warning");
      return;
    }

    const hasInvalidQuestion = builderState.some(
      (question) => !question.prompt || question.options.some((option) => !option.trim())
    );

    if (hasInvalidQuestion) {
      showToast("Every question needs a prompt and four answer options.", "warning");
      return;
    }

    try {
      setButtonLoading(saveQuizButton, true, "Publishing...");
      await saveQuizWithQuestions({
        quiz: {
          title,
          category,
          difficulty,
          description,
          durationSeconds,
          status: "published"
        },
        questions: builderState,
        author: {
          uid: profile.uid,
          name: profile.name || profile.email || "Teacher"
        }
      });

      builderForm.reset();
      builderState = [createQuestionDraft(), createQuestionDraft()];
      drawBuilder();
      await refreshStudioData();
      showToast("Quiz published to Firestore.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to save quiz."), "error");
    } finally {
      setButtonLoading(saveQuizButton, false);
    }
  });

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const quizId = document.querySelector("#settings-quiz-id").value;

    if (!quizId) {
      showToast("Load a quiz into the settings editor first.", "warning");
      return;
    }

    const payload = {
      title: document.querySelector("#settings-title").value.trim(),
      category: document.querySelector("#settings-category").value.trim(),
      difficulty: document.querySelector("#settings-difficulty").value,
      status: document.querySelector("#settings-status").value,
      description: document.querySelector("#settings-description").value.trim(),
      durationSeconds: Number(document.querySelector("#settings-duration").value || 15)
    };

    if (!payload.title || !payload.category || !payload.description) {
      showToast("Title, category, and description are required for quiz updates.", "warning");
      return;
    }

    try {
      setButtonLoading(updateQuizButton, true, "Updating...");
      await updateQuizMeta(quizId, payload);
      clearQuizSettingsForm(settingsForm);
      await refreshStudioData();
      showToast("Quiz settings updated.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to update quiz settings."), "error");
    } finally {
      setButtonLoading(updateQuizButton, false);
    }
  });

  seedDemoButton?.addEventListener("click", async () => {
    try {
      setButtonLoading(seedDemoButton, true, "Seeding...");
      await seedDemoQuiz({
        uid: profile.uid,
        name: profile.name || profile.email || "Quixxy"
      });
      await refreshStudioData();
      showToast("Demo quiz added to the catalog.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to seed demo content."), "error");
    } finally {
      setButtonLoading(seedDemoButton, false);
    }
  });

  const refreshBulkPreview = (items) => {
    if (!bulkImportPreviewPanel) {
      return;
    }

    if (!items.length) {
      bulkImportPreviewPanel.innerHTML = `
        <article>
          <strong>No parsed records</strong>
          <span>Upload a file and preview it before publishing.</span>
        </article>
      `;
      return;
    }

    const quizCount = new Set(items.map((item) => item.quizTitle)).size;
    bulkImportPreviewPanel.innerHTML = `
      <article>
        <strong>${quizCount} quiz ${quizCount === 1 ? "group" : "groups"} detected</strong>
        <span>${items.length} question row${items.length === 1 ? "" : "s"} validated and ready.</span>
      </article>
      ${items
        .slice(0, 5)
        .map(
          (item) => `
            <article>
              <strong>${item.quizTitle}</strong>
              <span>${item.question}</span>
            </article>
          `
        )
        .join("")}
    `;
  };

  const previewBulkImport = async () => {
    const file = bulkImportFileInput?.files?.[0];

    if (!file) {
      showToast("Select a file first.", "warning");
      return;
    }

    try {
      setButtonLoading(bulkImportPreviewButton, true, "Parsing...");
      const rows = await parseBulkImportFile(file);
      bulkImportPayload = validateBulkRows(rows);
      refreshBulkPreview(bulkImportPayload);
      showToast(`Validated ${bulkImportPayload.length} rows for import.`, "success");
    } catch (error) {
      bulkImportPayload = [];
      refreshBulkPreview([]);
      showToast(getErrorMessage(error, "Bulk import preview failed."), "error");
    } finally {
      setButtonLoading(bulkImportPreviewButton, false);
    }
  };

  bulkImportPreviewButton?.addEventListener("click", previewBulkImport);

  bulkImportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!bulkImportPayload.length) {
      await previewBulkImport();
    }

    if (!bulkImportPayload.length) {
      return;
    }

    try {
      setButtonLoading(bulkImportPublishButton, true, "Publishing...");
      const groupedQuizzes = groupBulkRowsByQuiz(bulkImportPayload);

      for (const quizGroup of groupedQuizzes) {
        await saveQuizWithQuestions({
          quiz: {
            title: quizGroup.quiz.title,
            category: quizGroup.quiz.category,
            difficulty: quizGroup.quiz.difficulty,
            description: quizGroup.quiz.description,
            durationSeconds: quizGroup.quiz.durationSeconds,
            status: "published"
          },
          questions: quizGroup.questions,
          author: {
            uid: profile.uid,
            name: profile.name || profile.email || "Quixxy Admin"
          }
        });
      }

      bulkImportPayload = [];
      bulkImportForm.reset();
      refreshBulkPreview([]);
      await refreshStudioData();
      showToast("Bulk import completed and pushed to Firestore.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Bulk import publish failed."), "error");
    } finally {
      setButtonLoading(bulkImportPublishButton, false);
    }
  });
}

function readStoredResult() {
  const rawPayload = sessionStorage.getItem(RESULT_STORAGE_KEY);

  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    console.error(error);
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function firstName(value) {
  return String(value || "")
    .trim()
    .split(" ")
    .filter(Boolean)[0] || "Learner";
}

async function parseBulkImportFile(file) {
  const fileName = String(file.name || "").toLowerCase();

  if (fileName.endsWith(".json")) {
    const content = await file.text();
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : parsed.items || [];
  }

  if (fileName.endsWith(".csv")) {
    const content = await file.text();
    return parseCsvRows(content);
  }

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const rows = parseExcelRows(buffer);
    return rows;
  }

  throw new Error("Unsupported file format. Use CSV, JSON, XLSX, or XLS.");
}

function parseCsvRows(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((item) => item.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function parseExcelRows(arrayBuffer) {
  const xlsx = window.XLSX;

  if (!xlsx) {
    throw new Error("Excel parser not loaded. Refresh the page and retry.");
  }

  const workbook = xlsx.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
}

function validateBulkRows(rows) {
  const normalized = rows
    .map((row) => normalizeBulkRow(row))
    .filter((row) => row.quizTitle && row.question && row.options.every((item) => item));

  if (!normalized.length) {
    throw new Error("No valid rows found. Check required fields and try again.");
  }

  return normalized;
}

function normalizeBulkRow(rawRow) {
  const row = rawRow || {};
  const options = [
    String(row.optionA ?? row.a ?? "").trim(),
    String(row.optionB ?? row.b ?? "").trim(),
    String(row.optionC ?? row.c ?? "").trim(),
    String(row.optionD ?? row.d ?? "").trim()
  ];
  const correctRaw = String(row.correctOption ?? row.correct ?? "A").trim().toUpperCase();
  const correctAnswer = Math.max(0, ["A", "B", "C", "D"].indexOf(correctRaw));

  return {
    quizTitle: String(row.quizTitle ?? row.title ?? "").trim(),
    category: String(row.category ?? "General").trim(),
    difficulty: String(row.difficulty ?? "Intermediate").trim(),
    description: String(row.description ?? "Imported quiz").trim(),
    durationSeconds: Number(row.durationSeconds || 15),
    question: String(row.question ?? row.prompt ?? "").trim(),
    options,
    correctAnswer,
    explanation: String(row.explanation ?? "").trim()
  };
}

function groupBulkRowsByQuiz(rows) {
  const quizMap = new Map();

  rows.forEach((row) => {
    if (!quizMap.has(row.quizTitle)) {
      quizMap.set(row.quizTitle, {
        quiz: {
          title: row.quizTitle,
          category: row.category,
          difficulty: row.difficulty,
          description: row.description,
          durationSeconds: row.durationSeconds
        },
        questions: []
      });
    }

    const group = quizMap.get(row.quizTitle);
    group.questions.push({
      prompt: row.question,
      options: row.options,
      correctAnswer: row.correctAnswer,
      explanation: row.explanation
    });
  });

  return [...quizMap.values()];
}

function initThemeToggle() {
  bindThemeToggle();
}
