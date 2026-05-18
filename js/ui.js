function ensureToastRoot() {
  let root = document.querySelector(".toast-root");

  if (!root) {
    root = document.createElement("div");
    root.className = "toast-root";
    document.body.append(root);
  }

  return root;
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function showToast(message, tone = "info", timeout = 4000) {
  const root = ensureToastRoot();
  const toast = document.createElement("div");

  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  root.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, timeout);
}

export function setButtonLoading(button, isLoading, loadingLabel = "Please wait...") {
  if (!button) {
    return;
  }

  if (isLoading) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = loadingLabel;
    return;
  }

  button.disabled = false;
  button.textContent = button.dataset.originalLabel || button.textContent;
}

export function setTextContent(target, value) {
  const element = typeof target === "string" ? document.querySelector(target) : target;

  if (element) {
    element.textContent = value;
  }
}

export function renderPageMessage(container, { title, description, actions = [] }) {
  if (!container) {
    return;
  }

  const actionsMarkup = actions.length
    ? `<div class="hero-actions">${actions
        .map(
          (action) =>
            `<a class="btn ${action.variant || "btn-secondary"}" href="${escapeHTML(action.href)}">${escapeHTML(
              action.label
            )}</a>`
        )
        .join("")}</div>`
    : "";

  container.innerHTML = `
    <section class="glass-card empty-state">
      <h2>${escapeHTML(title)}</h2>
      <p>${escapeHTML(description)}</p>
      ${actionsMarkup}
    </section>
  `;
}

export function renderCategoryChips(container, quizzes) {
  if (!container) {
    return;
  }

  const categories = [...new Set(quizzes.map((quiz) => quiz.category).filter(Boolean))];

  if (!categories.length) {
    container.innerHTML = '<span class="chip">No categories yet</span>';
    return;
  }

  container.innerHTML = categories.map((category) => `<span class="chip">${escapeHTML(category)}</span>`).join("");
}

export function renderQuizCatalog(container, quizzes) {
  if (!container) {
    return;
  }

  if (!quizzes.length) {
    container.innerHTML = `
      <div class="glass-card empty-state">
        <h3>No quizzes available yet</h3>
        <p>Ask a teacher to publish a quiz, or seed demo content from the studio.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = quizzes
    .map(
      (quiz) => `
        <article class="glass-card quiz-card">
          <div class="quiz-card-header">
            <div>
              <div class="quiz-badge">${escapeHTML(quiz.category || "General")}</div>
              <h3>${escapeHTML(quiz.title)}</h3>
            </div>
            <span class="status-badge status-${escapeHTML(quiz.status || "published")}">${escapeHTML(
              quiz.status || "published"
            )}</span>
          </div>

          <p>${escapeHTML(quiz.description || "No description provided yet.")}</p>

          <div class="quiz-meta-row">
            <span class="meta-pill">${escapeHTML(quiz.difficulty || "Intermediate")}</span>
            <span class="meta-pill">${Number(quiz.questionCount || 0)} questions</span>
            <span class="meta-pill">${Number(quiz.durationSeconds || 15)}s timer</span>
          </div>

          <div class="quiz-card-footer">
            <span class="muted-copy">Created by ${escapeHTML(quiz.createdByName || "Quixxy")}</span>
            <a class="btn btn-primary" href="./quiz.html?id=${encodeURIComponent(quiz.id)}">Start Quiz</a>
          </div>
        </article>
      `
    )
    .join("");
}

export function renderLeaderboard(container, entries) {
  if (!container) {
    return;
  }

  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Leaderboard is empty</h3>
        <p>Complete a quiz to populate the first ranking entries.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <ol class="leaderboard-list">
      ${entries
        .map(
          (entry, index) => `
            <li class="leaderboard-item">
              <span class="leaderboard-rank">${index + 1}</span>
              <div>
                <div class="leaderboard-name">${escapeHTML(entry.userName || "Player")}</div>
                <div class="leaderboard-meta">${escapeHTML(entry.quizTitle || "Quiz")} | ${escapeHTML(
                  entry.category || "General"
                )}</div>
              </div>
              <div class="leaderboard-score">
                <strong>${Number(entry.percentage || 0)}%</strong>
                <span class="leaderboard-meta">${Number(entry.score || 0)} pts</span>
              </div>
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

export function createQuestionDraft(overrides = {}) {
  const timerSeconds = Number(overrides.timerSeconds ?? overrides.timer ?? 30);

  return {
    prompt: overrides.prompt || "",
    options: Array.isArray(overrides.options) && overrides.options.length === 4 ? overrides.options : ["", "", "", ""],
    correctAnswer: Number.isInteger(overrides.correctAnswer) ? overrides.correctAnswer : 0,
    explanation: overrides.explanation || "",
    timerSeconds: Math.min(120, Math.max(5, Number.isFinite(timerSeconds) ? timerSeconds : 30))
  };
}

export function renderQuestionBuilder(container, questions) {
  if (!container) {
    return;
  }

  container.innerHTML = questions
    .map((question, index) => {
      const optionMarkup = question.options
        .map(
          (option, optionIndex) => `
            <label class="input-group">
              <span>Option ${String.fromCharCode(65 + optionIndex)}</span>
              <input type="text" data-option-index="${optionIndex}" value="${escapeHTML(option)}" placeholder="Answer choice ${
                optionIndex + 1
              }" />
            </label>
          `
        )
        .join("");

      return `
        <article class="question-builder-item" data-question-index="${index}">
          <div class="builder-header">
            <h3>Question ${index + 1}</h3>
            <button type="button" class="btn btn-ghost" data-action="remove-question" data-index="${index}" ${
              questions.length === 1 ? "disabled" : ""
            }>Remove</button>
          </div>

          <label class="input-group">
            <span>Prompt</span>
            <textarea rows="3" data-field="prompt" placeholder="Write the question prompt here.">${escapeHTML(
              question.prompt
            )}</textarea>
          </label>

          <div class="builder-options">${optionMarkup}</div>

          <div class="form-grid compact-grid">
            <label class="input-group">
              <span>Correct Answer</span>
              <select data-field="correctAnswer">
                ${["A", "B", "C", "D"]
                  .map(
                    (label, optionIndex) => `
                      <option value="${optionIndex}" ${question.correctAnswer === optionIndex ? "selected" : ""}>
                        Option ${label}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>

            <label class="input-group">
              <span>Question timer (seconds)</span>
              <input
                type="number"
                min="5"
                max="120"
                step="1"
                data-field="timerSeconds"
                value="${Number(question.timerSeconds ?? 30)}"
              />
            </label>
          </div>

          <label class="input-group">
            <span>Explanation</span>
            <input type="text" data-field="explanation" value="${escapeHTML(
              question.explanation
            )}" placeholder="Short explanation after reveal" />
          </label>
        </article>
      `;
    })
    .join("");
}

export function collectQuestionDrafts(container) {
  const items = [...container.querySelectorAll(".question-builder-item")];

  return items.map((item) => {
    const prompt = item.querySelector('[data-field="prompt"]').value.trim();
    const options = [...item.querySelectorAll("[data-option-index]")].map((input) => input.value.trim());
    const correctAnswer = Number(item.querySelector('[data-field="correctAnswer"]').value);
    const explanation = item.querySelector('[data-field="explanation"]').value.trim();
    const timerField = item.querySelector('[data-field="timerSeconds"]');
    const timerSeconds = Math.min(120, Math.max(5, Number(timerField?.value || 30)));

    return {
      prompt,
      options,
      correctAnswer,
      explanation,
      timerSeconds
    };
  });
}

export function renderQuizManagement(container, quizzes, { onLoad, onDelete } = {}) {
  if (!container) {
    return;
  }

  if (!quizzes.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No managed quizzes yet</h3>
        <p>Create your first quiz with the builder to populate this list.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = quizzes
    .map(
      (quiz) => `
        <article class="management-card">
          <div class="management-header">
            <div>
              <h3>${escapeHTML(quiz.title)}</h3>
              <p>${escapeHTML(quiz.description || "No description provided.")}</p>
            </div>
            <span class="status-badge status-${escapeHTML(quiz.status || "published")}">${escapeHTML(
              quiz.status || "published"
            )}</span>
          </div>

          <div class="meta-row">
            <span class="meta-pill">${escapeHTML(quiz.category || "General")}</span>
            <span class="meta-pill">${escapeHTML(quiz.difficulty || "Intermediate")}</span>
            <span class="meta-pill">${Number(quiz.questionCount || 0)} questions</span>
            <span class="meta-pill">${Number(quiz.durationSeconds || 15)}s</span>
          </div>

          <div class="management-footer">
            <span class="muted-copy">Owner: ${escapeHTML(quiz.createdByName || "Quixxy")}</span>
            <div class="hero-actions">
              <button class="btn btn-secondary" type="button" data-action="load-settings" data-quiz-id="${escapeHTML(
                quiz.id
              )}">Edit Settings</button>
              <button class="btn btn-ghost" type="button" data-action="delete-quiz" data-quiz-id="${escapeHTML(
                quiz.id
              )}">Delete</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  container.querySelectorAll('[data-action="load-settings"]').forEach((button) => {
    button.addEventListener("click", () => onLoad?.(button.dataset.quizId));
  });

  container.querySelectorAll('[data-action="delete-quiz"]').forEach((button) => {
    button.addEventListener("click", () => onDelete?.(button.dataset.quizId));
  });
}

export function populateQuizSettingsForm(form, quiz) {
  if (!form || !quiz) {
    return;
  }

  form.querySelector("#settings-quiz-id").value = quiz.id || "";
  form.querySelector("#settings-title").value = quiz.title || "";
  form.querySelector("#settings-category").value = quiz.category || "";
  form.querySelector("#settings-difficulty").value = quiz.difficulty || "Intermediate";
  form.querySelector("#settings-status").value = quiz.status || "published";
  form.querySelector("#settings-description").value = quiz.description || "";
  form.querySelector("#settings-duration").value = Number(quiz.durationSeconds || 15);
}

export function clearQuizSettingsForm(form) {
  if (!form) {
    return;
  }

  form.reset();
  form.querySelector("#settings-quiz-id").value = "";
  form.querySelector("#settings-difficulty").value = "Intermediate";
  form.querySelector("#settings-status").value = "published";
  form.querySelector("#settings-duration").value = "15";
}

export function renderUsersTable(container, users) {
  if (!container) {
    return;
  }

  if (!users.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No users found</h3>
        <p>Registered accounts will appear here once signups begin.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Attempts</th>
          <th>Total Points</th>
        </tr>
      </thead>
      <tbody>
        ${users
          .map(
            (user) => `
              <tr>
                <td>${escapeHTML(user.name || "Quixxy User")}</td>
                <td>${escapeHTML(user.email || "Unknown")}</td>
                <td><span class="role-badge role-${escapeHTML(user.role || "student")}">${escapeHTML(
                  user.role || "student"
                )}</span></td>
                <td>${Number(user.attemptsCount || 0)}</td>
                <td>${Number(user.totalPoints || 0)}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

export function renderQuizOptions(container, question, onSelect) {
  if (!container || !question) {
    return;
  }

  container.innerHTML = question.options
    .map(
      (option, index) => `
        <button class="option-button" type="button" data-option-index="${index}">
          <span class="option-key">${String.fromCharCode(65 + index)}</span>
          <span>${escapeHTML(option)}</span>
        </button>
      `
    )
    .join("");

  container.querySelectorAll("[data-option-index]").forEach((button) => {
    button.addEventListener("click", () => onSelect?.(Number(button.dataset.optionIndex)));
  });
}

export function revealQuizAnswer(container, { selectedIndex, correctIndex }) {
  if (!container) {
    return;
  }

  container.querySelectorAll("[data-option-index]").forEach((button) => {
    const optionIndex = Number(button.dataset.optionIndex);
    button.disabled = true;

    if (optionIndex === correctIndex) {
      button.classList.add("correct");
    }

    if (selectedIndex === optionIndex && selectedIndex !== correctIndex) {
      button.classList.add("incorrect");
    }
  });
}

export function renderResultBreakdown(container, result) {
  if (!container) {
    return;
  }

  container.innerHTML = result.answers
    .map((answer, index) => {
      const cardClass = answer.isCorrect ? "correct" : answer.selectedIndex === null ? "unanswered" : "incorrect";
      const statusText = answer.isCorrect ? "Correct" : answer.selectedIndex === null ? "Timed Out" : "Incorrect";
      const selectedLabel =
        answer.selectedIndex === null ? "No answer selected" : answer.options[answer.selectedIndex] || "No answer selected";
      const correctLabel = answer.options[answer.correctIndex] || "Not available";

      return `
        <article class="answer-card ${cardClass}">
          <div class="answer-card-header">
            <h3>Question ${index + 1}</h3>
            <span class="answer-status">${statusText}</span>
          </div>
          <p>${escapeHTML(answer.prompt)}</p>
          <div class="answer-meta">
            <span>Your answer: ${escapeHTML(selectedLabel)}</span>
            <span>Correct answer: ${escapeHTML(correctLabel)}</span>
            ${
              answer.explanation
                ? `<span>Why: ${escapeHTML(answer.explanation)}</span>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}
