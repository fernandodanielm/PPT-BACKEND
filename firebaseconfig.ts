// firebaseConfig.ts
export const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyBqoATuWSOg3ZDbSBOsvLiww1xc5xLSxak",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "desafio-ppt-e6f00.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "desafio-ppt-e6f00",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "desafio-ppt-e6f00.firebasestorage.app",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1005620596792",
    appId: process.env.FIREBASE_APP_ID || "1:1005620596792:web:186bd21929786d9e1f16cd",
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://desafio-ppt-e6f00-default-rtdb.firebaseio.com",
};