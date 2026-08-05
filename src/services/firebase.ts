import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase web configuration values identify this public client. They are not
// service-account credentials and are protected by Authentication and Rules.
const firebaseConfig = {
  apiKey: "AIzaSyB86uVmHbCugT0Vt_xRK4ars0T_qlmJu-w",
  authDomain: "study-journal-408-9f31.firebaseapp.com",
  projectId: "study-journal-408-9f31",
  storageBucket: "study-journal-408-9f31.firebasestorage.app",
  messagingSenderId: "545473367044",
  appId: "1:545473367044:web:2d4d9a2ee7ff1c7a903951",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const googleAuthProvider = new GoogleAuthProvider();
export const firestore = getFirestore(firebaseApp);
export const firebaseStorage = getStorage(firebaseApp);
