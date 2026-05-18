import { getRoleHome, requireAuth } from "./auth.js";
import { getPlatformSettings, getUserSettings, updatePlatformSettings, updateUserSettings } from "./db.js";
import { applyStoredTheme, bindThemeToggle, persistTheme } from "./theme.js";
import { setButtonLoading, showToast } from "./ui.js";

document.addEventListener("DOMContentLoaded", () => {
  applyStoredTheme();
  bindThemeToggle();
  initSettingsPage().catch((error) => {
    console.error(error);
    showToast(error.message || "Could not load settings.", "error");
  });
});

async function initSettingsPage() {
  const session = await requireAuth({ allowedRoles: ["student", "teacher", "admin"] });
  if (!session) {
    return;
  }

  const { profile } = session;
  const homeLink = document.querySelector("#settings-home-link");
  if (homeLink) {
    homeLink.href = getRoleHome(profile.role);
  }

  document.querySelector("#settings-brand-home")?.setAttribute("href", getRoleHome(profile.role));

  document.querySelector("#settings-teacher-only")?.classList.toggle("is-hidden", profile.role === "student");
  document.querySelector("#settings-sound-row")?.classList.toggle("is-hidden", profile.role === "student");
  document.querySelector("#settings-student-only")?.classList.toggle("is-hidden", profile.role !== "student");

  const userSettings = await getUserSettings(profile.uid);
  hydrateUserSettings(userSettings, profile.role);

  const userForm = document.querySelector("#user-settings-form");
  const userSaveButton = document.querySelector("#save-user-settings");
  userForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readUserSettingsPayload(profile.role);

    try {
      setButtonLoading(userSaveButton, true, "Saving...");
      await updateUserSettings(profile.uid, payload);
      persistTheme(payload.theme || "dark");
      showToast("Settings saved.", "success");
    } catch (error) {
      showToast(error.message || "Could not save settings.", "error");
    } finally {
      setButtonLoading(userSaveButton, false);
    }
  });

  if (profile.role === "admin") {
    const adminPanel = document.querySelector("#admin-settings-panel");
    adminPanel?.classList.remove("is-hidden");
    const platformSettings = await getPlatformSettings();
    hydrateAdminSettings(platformSettings);

    const adminForm = document.querySelector("#admin-settings-form");
    const adminSaveButton = document.querySelector("#save-admin-settings");
    adminForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        setButtonLoading(adminSaveButton, true, "Saving...");
        await updatePlatformSettings(readAdminSettingsPayload());
        showToast("Admin settings updated.", "success");
      } catch (error) {
        showToast(error.message || "Unable to save admin settings.", "error");
      } finally {
        setButtonLoading(adminSaveButton, false);
      }
    });
  }
}

function hydrateUserSettings(settings, role) {
  if (role !== "student") {
    const institute = document.querySelector("#settings-institute");
    const image = document.querySelector("#settings-image");
    const timer = document.querySelector("#settings-timer");
    const sound = document.querySelector("#settings-sound");
    if (institute) institute.value = settings.instituteName || "";
    if (image) image.value = settings.profileImage || "";
    if (timer) timer.value = Number(settings.defaultTimer || 30);
    if (sound) sound.checked = settings.soundEnabled !== false;
  }

  const themeSelect = document.querySelector("#settings-theme");
  if (themeSelect) {
    themeSelect.value = settings.theme === "light" ? "light" : "dark";
  }

  persistTheme(settings.theme === "light" ? "light" : "dark");

  const notifications = document.querySelector("#settings-notifications");
  if (notifications) {
    notifications.checked = settings.notificationsEnabled !== false;
  }
}

function readUserSettingsPayload(role) {
  const theme = document.querySelector("#settings-theme")?.value === "light" ? "light" : "dark";
  const notificationsEnabled = document.querySelector("#settings-notifications")?.checked !== false;

  if (role === "student") {
    return {
      theme,
      notificationsEnabled
    };
  }

  return {
    instituteName: document.querySelector("#settings-institute")?.value.trim() || "",
    profileImage: document.querySelector("#settings-image")?.value.trim() || "",
    defaultTimer: Number(document.querySelector("#settings-timer")?.value || 30),
    theme,
    soundEnabled: document.querySelector("#settings-sound")?.checked !== false,
    notificationsEnabled
  };
}

function hydrateAdminSettings(settings) {
  const brandName = document.querySelector("#admin-brand-name");
  const brandLogo = document.querySelector("#admin-brand-logo");
  const moderation = document.querySelector("#admin-moderation");
  const analytics = document.querySelector("#admin-analytics");
  if (brandName) brandName.value = settings.brandName || "Quixxy";
  if (brandLogo) brandLogo.value = settings.logoUrl || "";
  if (moderation) moderation.value = settings.moderationMode || "standard";
  if (analytics) analytics.value = settings.analyticsMode || "standard";
}

function readAdminSettingsPayload() {
  return {
    brandName: document.querySelector("#admin-brand-name")?.value.trim() || "Quixxy",
    logoUrl: document.querySelector("#admin-brand-logo")?.value.trim() || "",
    moderationMode: document.querySelector("#admin-moderation")?.value || "standard",
    analyticsMode: document.querySelector("#admin-analytics")?.value || "standard"
  };
}
