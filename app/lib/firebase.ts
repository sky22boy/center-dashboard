import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBd_fKsyTQprQ3nxhEZxRpd-3NQlZaMBSQ",
  authDomain: "center-2649a.firebaseapp.com",
  projectId: "center-2649a",
  storageBucket: "center-2649a.firebasestorage.app",
  messagingSenderId: "778071193354",
  appId: "1:778071193354:web:0f2bba20566a7c7060acf3",
  measurementId: "G-CYPQSFMYP5",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
