import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

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

/**
 * Firestore's default transport is a WebSocket/gRPC streaming connection, which some networks
 * (corporate proxies, certain carriers/VPNs, and — notably for this app's userbase — mainland
 * China's access to Google-hosted services) silently drop or block without ever returning an
 * error: the request just hangs. `experimentalAutoDetectLongPolling` makes the SDK probe for that
 * case and fall back to plain HTTP long-polling, which tunnels through the same restrictive
 * networks far more reliably. It only kicks in when the streaming connection actually fails to
 * establish, so it's a no-op on a normal network.
 *
 * `initializeFirestore` throws if this app already has a Firestore instance — which happens on a
 * Vite HMR reload of this module in dev, since `firebaseApp` above resolves to the same
 * already-initialized app. Fall back to `getFirestore` (returns the existing instance) instead of
 * crashing the module in that case.
 */
export const firestore = (() => {
  try {
    return initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true });
  } catch {
    return getFirestore(firebaseApp);
  }
})();

export const firebaseStorage = getStorage(firebaseApp);
export const firebaseFunctions = getFunctions(firebaseApp, "us-central1");
