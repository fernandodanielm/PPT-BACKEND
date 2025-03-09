"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
require('dotenv').config();
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
firebase_admin_1.default.initializeApp({
    credential: firebase_admin_1.default.credential.cert(serviceAccount),
    databaseURL: "https://desafio-ppt-e6f00-default-rtdb.firebaseio.com",
});
const db = firebase_admin_1.default.database();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.post("/api/rooms", (req, res) => {
    let roomId = generateShortId();
    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot) => {
        if (snapshot.exists()) {
            roomId = generateShortId();
        }
        const newRoomRef = db.ref(`rooms/${roomId}`);
        newRoomRef.set({
            player1Name: "",
            player2Name: "",
            player1Play: null,
            player2Play: null,
            statistics: {
                player1: { wins: 0, losses: 0, draws: 0 },
                player2: { wins: 0, losses: 0, draws: 0 },
            },
            gameOver: false,
            readyForNextRound: false,
        });
        res.json({ roomId: roomId });
    });
});
app.put("/api/rooms/:roomId/join", (req, res) => {
    const { roomId } = req.params;
    const { playerName } = req.body;
    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot) => {
        const roomData = snapshot.val();
        if (roomData) {
            if (!roomData.player1Name) {
                roomRef.update({ player1Name: playerName });
                res.json({ playerNumber: 1 });
            }
            else if (!roomData.player2Name) {
                roomRef.update({ player2Name: playerName });
                res.json({ playerNumber: 2 });
            }
            else {
                res.status(400).json({ message: "Sala llena" });
            }
        }
        else {
            res.status(404).json({ message: "Sala no encontrada" });
        }
    });
});
app.put("/api/rooms/:roomId/move", (req, res) => {
    const { roomId } = req.params;
    const { playerNumber, move } = req.body;
    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot) => {
        const roomData = snapshot.val();
        if (roomData) {
            if (playerNumber === 1) {
                roomRef.update({ player1Play: move });
            }
            else {
                roomRef.update({ player2Play: move });
            }
            if (roomData.player1Play && roomData.player2Play) {
                let player1Wins = roomData.statistics.player1.wins;
                let player1Losses = roomData.statistics.player1.losses;
                let player1Draws = roomData.statistics.player1.draws;
                let player2Wins = roomData.statistics.player2.wins;
                let player2Losses = roomData.statistics.player2.losses;
                let player2Draws = roomData.statistics.player2.draws;
                if (roomData.player1Play === roomData.player2Play) {
                    player1Draws++;
                    player2Draws++;
                }
                else if ((roomData.player1Play === "piedra" && roomData.player2Play === "tijera") ||
                    (roomData.player1Play === "tijera" && roomData.player2Play === "papel") ||
                    (roomData.player1Play === "papel" && roomData.player2Play === "piedra")) {
                    player1Wins++;
                    player2Losses++;
                }
                else {
                    player2Wins++;
                    player1Losses++;
                }
                roomRef.update({
                    statistics: {
                        player1: { wins: player1Wins, losses: player1Losses, draws: player1Draws },
                        player2: { wins: player2Wins, losses: player2Losses, draws: player2Draws },
                    },
                    player1Play: null,
                    player2Play: null,
                    gameOver: true,
                });
            }
            res.json({ message: "Movimiento registrado" });
        }
        else {
            res.status(404).json({ message: "Sala no encontrada" });
        }
    });
});
function generateShortId() {
    let roomId = Math.floor(1000 + Math.random() * 9000);
    return roomId.toString();
}
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map