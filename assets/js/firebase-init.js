// js/firebase-init.js

// 1. Importa as bibliotecas Firebase a partir da CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// 2. Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAtwYV-toZBKbSwg2PE4AhTsJ47AaPKD4Q",
  authDomain: "agrocultiveapps.firebaseapp.com",
  projectId: "agrocultiveapps",
  storageBucket: "agrocultiveapps.appspot.com",
  messagingSenderId: "1095510209034",
  appId: "1:1095510209034:web:9dac124513d1eb584a25f3"
};

// 3. Inicializa e exporta as instâncias do Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };