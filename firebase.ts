// firebase.ts
import admin from "firebase-admin";

// Inicializa Firebase Admin con tus credenciales
const serviceAccount = require("./key.json"); // Reemplaza con la ruta a tu archivo serviceAccountKey.json

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

export const firestore = admin.firestore();