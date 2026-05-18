import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDegW-iuJFRjUlFI5znzU9x4Oaulsl26nw",
  authDomain: "quixxy-1a145.firebaseapp.com",
  projectId: "quixxy-1a145",
  storageBucket: "quixxy-1a145.firebasestorage.app",
  messagingSenderId: "195611299858",
  appId: "1:195611299858:web:4fb299463db384775348cb"
};

const placeholderMarkers = ["YOUR_", "<"];

export const isFirebaseConfigured = Object.values(firebaseConfig).every((value) => {
  const normalized = String(value ?? "").trim();
  return normalized && !placeholderMarkers.some((marker) => normalized.startsWith(marker));
});

export function assertFirebaseConfigured() {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured. Update config/firebase.js with your project credentials.");
  }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage, firebaseConfig };
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

const analytics = getAnalytics(app);