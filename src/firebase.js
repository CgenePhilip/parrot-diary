// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // 👈 DB 연결을 위해 추가된 마법의 주문

// 대표님의 고유 Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyC8e4q_l2wwBMph57OGwHgA1Yfs8EeNW_Y",
  authDomain: "parrot-diary.firebaseapp.com",
  projectId: "parrot-diary",
  storageBucket: "parrot-diary.firebasestorage.app",
  messagingSenderId: "702072119681",
  appId: "1:702072119681:web:8784dfd8fd020f449ac880"
};

// Firebase 초기화 및 DB 내보내기
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app); // 👈 이제 다른 파일에서 이 'db'를 불러다 쓸 수 있습니다!