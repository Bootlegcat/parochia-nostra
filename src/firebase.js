import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ⚠️ Analytics solo en browser
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCjsQndKQIjJfiAei_AdBWz83-ktgmUivA",
  authDomain: "parochia-nostra.firebaseapp.com",
  projectId: "parochia-nostra",
  storageBucket: "parochia-nostra.firebasestorage.app",
  messagingSenderId: "625007751701",
  appId: "1:625007751701:web:f72e70da7eb4546976141c",
  measurementId: "G-401VK4M2J4",
};

// 🔥 Inicializar Firebase
const app = initializeApp(firebaseConfig);

// 🔐 Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// 🧠 Firestore
export const db = getFirestore(app);

// ✅ Storage
export const storage = getStorage(app);

// 📊 Analytics (opcional y seguro)
export let analytics = null;

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}
