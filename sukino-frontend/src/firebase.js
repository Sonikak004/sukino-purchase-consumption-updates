// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase config (your project’s details)
const firebaseConfig = {
  apiKey: "AIzaSyCizwqDIj1m1OAud5QON_I9uG4nzGChMtY",
  authDomain: "sukino-login.firebaseapp.com",
  projectId: "sukino-login",
  storageBucket: "sukino-login.firebasestorage.app",
  messagingSenderId: "810089503369",
  appId: "1:810089503369:web:9442dec6f6f3d8d30dc458",
  measurementId: "G-DF1QFMSP16"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export services
export const auth = getAuth(app);
export const db = getFirestore(app);
