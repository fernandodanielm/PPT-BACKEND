"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express")); // Import RequestHandler
const cors_1 = __importDefault(require("cors"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const http = __importStar(require("http"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
if (!serviceAccount) {
    console.error("La variable de entorno FIREBASE_SERVICE_ACCOUNT no está definida o no es un JSON válido.");
    process.exit(1);
}
firebase_admin_1.default.initializeApp({
    credential: firebase_admin_1.default.credential.cert(serviceAccount),
    databaseURL: "https://desafio-ppt-e6f00-default-rtdb.firebaseio.com",
});
const db = firebase_admin_1.default.database();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const server = http.createServer(app);
function generateNumericRoomId() {
    return Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
}
// Rutas de la API
app.post("/api/rooms", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let roomId = generateNumericRoomId().toString();
        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = yield roomRef.once("value");
        if (snapshot.exists()) {
            roomId = generateNumericRoomId().toString();
        }
        const newRoomRef = db.ref(`rooms/${roomId}`);
        console.log("Cuerpo de la solicitud:", req.body);
        const { playerName } = req.body;
        console.log("Nombre del jugador:", playerName);
        const newRoom = {
            currentGame: {
                data: {
                    player1Name: playerName,
                    player2Name: "",
                    player1Play: null,
                    player2Play: null,
                    gameOver: false,
                },
                statistics: {
                    player1: { wins: 0, losses: 0, draws: 0 },
                    player2: { wins: 0, losses: 0, draws: 0 },
                },
            },
            readyForNextRound: false,
        };
        yield newRoomRef.set(newRoom);
        res.json({ roomId: roomId, currentGame: newRoom.currentGame });
        console.log(`Sala creada con roomId: ${roomId}`);
    }
    catch (error) {
        console.error("Error al crear la sala:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
}));
app.put("/api/rooms/:roomId/join", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roomId = req.params.roomId;
        const { playerName } = req.body;
        if (!roomId || !/^\d{4}$/.test(roomId)) { // Improved validation
            console.error(`roomId inválido: ${roomId}`);
            return res.status(400).json({ message: "roomId inválido. Debe ser un número de 4 dígitos." });
        }
        const roomRef = db.ref(`rooms/${roomId}/currentGame/data`);
        const snapshot = yield roomRef.once("value");
        if (snapshot.exists()) {
            const roomData = snapshot.val();
            if (!roomData.player2Name) {
                yield roomRef.update({ player2Name: playerName });
                db.ref(`rooms/${roomId}/currentGame/data/player2Name`).on("value", (snapshot) => {
                    if (snapshot.exists()) {
                        const newPlayer2Name = snapshot.val();
                        db.ref(`rooms/${roomId}/notifications`).push({
                            type: "playerJoined",
                            player2Name: newPlayer2Name,
                        });
                    }
                });
                const updatedRoom = yield db
                    .ref(`rooms/${roomId}/currentGame`)
                    .once("value");
                res.json({ currentGame: updatedRoom.val() });
                console.log(`Jugador ${playerName} se unió a la sala ${roomId}`);
            }
            else {
                console.log(`La sala ${roomId} ya está llena.`);
                res.status(409).json({ message: "La sala ya está llena." });
            }
        }
        else {
            console.log(`Sala ${roomId} no encontrada.`);
            res.status(404).json({ message: "Sala no encontrada." });
        }
    }
    catch (error) {
        console.error("Error al unirse a la sala:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
}));
app.put("/api/rooms/:roomId/move", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roomId = req.params.roomId;
        const { playerNumber, move } = req.body;
        if (!roomId || !/^\d{4}$/.test(roomId)) { // Improved validation
            console.error(`roomId inválido: ${roomId}`);
            return res.status(400).json({ message: "roomId inválido. Debe ser un número de 4 dígitos." });
        }
        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = yield roomRef.once("value");
        const roomData = snapshot.val();
        if (roomData) {
            if (playerNumber === 1) {
                yield roomRef.update({ "currentGame/data/player1Play": move });
            }
            else {
                yield roomRef.update({ "currentGame/data/player2Play": move });
            }
            if (roomData.currentGame.data.player1Play && roomData.currentGame.data.player2Play) {
                // ... (lógica del juego)
                yield roomRef.update({
                // ... (actualización de estadísticas y estado del juego)
                });
                db.ref(`rooms/${roomId}/notifications`).push({
                    type: "gameOver",
                    currentGame: roomData.currentGame,
                });
            }
            res.json({ message: "Movimiento registrado" });
            console.log(`Movimiento registrado en la sala ${roomId}`);
        }
        else {
            console.log(`Sala ${roomId} no encontrada.`);
            res.status(404).json({ message: "Sala no encontrada" });
        }
    }
    catch (error) {
        console.error("Error al registrar el movimiento:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
}));
// Iniciar el servidor
server.listen(port, () => {
    console.log(`Servidor iniciado en el puerto ${port}`);
});
//# sourceMappingURL=index.js.map