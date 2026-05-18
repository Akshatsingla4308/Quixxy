import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, assertFirebaseConfigured, isFirebaseConfigured } from "../config/firebase.js";
import { createUserProfile, getUserProfile } from "./db.js";

async function hydrateProfile(user) {
  let profile = await getUserProfile(user.uid);

  if (!profile) {
    profile = await createUserProfile({
      uid: user.uid,
      name: user.displayName || user.email?.split("@")[0] || "Quixxy User",
      email: user.email || "",
      role: "student"
    });
  }

  return profile;
}

export function getRoleHome(role = "student") {
  if (role === "admin") {
    return "./admin.html";
  }

  if (role === "teacher") {
    return "./teacher.html";
  }

  return "./dashboard.html";
}

export async function signUpWithEmailPassword({ name, email, password, role }) {
  assertFirebaseConfigured();
  await setPersistence(auth, browserLocalPersistence);

  const credential = await createUserWithEmailAndPassword(auth, email, password);

  if (name) {
    await updateProfile(credential.user, { displayName: name });
  }

  const profile = await createUserProfile({
    uid: credential.user.uid,
    name,
    email,
    role
  });

  await sendEmailVerification(credential.user);
  await signOut(auth);

  return { user: credential.user, profile };
}

export async function signInWithEmailPassword({ email, password }) {
  assertFirebaseConfigured();
  await setPersistence(auth, browserLocalPersistence);

  const credential = await signInWithEmailAndPassword(auth, email, password);
  if (!credential.user.emailVerified) {
  throw new Error("Please verify your email first.");
  }
  const profile = await hydrateProfile(credential.user);
  return { user: credential.user, profile, needsVerification: true };
}

export async function signOutCurrentUser() {
  assertFirebaseConfigured();
  await signOut(auth);
}

export async function resolveSessionUser() {
  if (!isFirebaseConfigured) {
    return { user: null, profile: null, configured: false };
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        unsubscribe();

        if (!user) {
          resolve({ user: null, profile: null, configured: true });
          return;
        }

        try {
          const profile = await hydrateProfile(user);
          resolve({ user, profile, configured: true });
        } catch (error) {
          reject(error);
        }
      },
      reject
    );
  });
}

export async function redirectIfAuthenticated() {
  const session = await resolveSessionUser();

  if (session.user && session.profile) {
    window.location.assign(getRoleHome(session.profile.role));
    return true;
  }

  return false;
}

export async function requireAuth({ allowedRoles = [] } = {}) {
  const session = await resolveSessionUser();

  if (!session.configured) {
    return null;
  }

  if (!session.user || !session.profile) {
    window.location.assign("./login.html");
    return null;
  }

  if (allowedRoles.length && !allowedRoles.includes(session.profile.role)) {
    window.location.assign(getRoleHome(session.profile.role));
    return null;
  }

  return session;
}
