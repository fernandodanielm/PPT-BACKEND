"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firestore = void 0;
// firebase.ts
const firebase_admin_1 = __importDefault(require("firebase-admin"));
// Inicializa Firebase Admin con tus credenciales
const serviceAccount = require("./key.json"); // Reemplaza con la ruta a tu archivo serviceAccountKey.json
firebase_admin_1.default.initializeApp({
    credential: firebase_admin_1.default.credential.cert(serviceAccount),
});
exports.firestore = firebase_admin_1.default.firestore();
//# sourceMappingURL=firebase.js.map