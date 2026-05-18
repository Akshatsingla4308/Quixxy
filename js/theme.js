const STORAGE_KEY = "quixxy-theme";

export function applyStoredTheme() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") {
      document.documentElement.dataset.theme = value;
    }
  } catch {
    /* ignore */
  }
}

export function persistTheme(theme) {
  const next = theme === "light" ? "light" : "dark";

  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }

  document.documentElement.dataset.theme = next;
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme || "dark";
  const next = current === "dark" ? "light" : "dark";
  persistTheme(next);
  return next;
}

export function getCurrentTheme() {
  return document.documentElement.dataset.theme || "dark";
}

export function bindThemeToggle(selector = "#theme-toggle") {
  const toggleButton = document.querySelector(selector);
  if (!toggleButton) {
    return;
  }

  const icon = toggleButton.querySelector(".theme-icon");
  const updateIcon = () => {
    const theme = getCurrentTheme();
    if (icon) {
      icon.textContent = theme === "dark" ? "Dark" : "Light";
    }
    toggleButton.setAttribute("aria-pressed", String(theme === "light"));
  };

  updateIcon();
  toggleButton.addEventListener("click", () => {
    toggleTheme();
    updateIcon();
  });
}
