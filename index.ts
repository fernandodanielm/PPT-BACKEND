import express from 'express';
import { json } from "body-parser";
import { DataSnapshot } from "firebase-admin/database";
import cors from "cors";
import admin from "firebase-admin";
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as dotenv from 'dotenv';

dotenv.config();

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)
    : null;

if (!serviceAccount) {
    console.error("La variable de entorno FIREBASE_SERVICE_ACCOUNT no está definida o no es un JSON válido.");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://desafio-ppt-e6f00-default-rtdb.firebaseio.com",
});

const db = admin.database();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const server = http.createServer(app); // Crear servidor HTTP con Express
const wss = new WebSocketServer({ server }); // Pasar el servidor HTTP al constructor de WebSocketServer
const clients = new Map<string, WebSocket>();

wss.on('connection', (ws) => {
    console.log('Cliente WebSocket conectado');

    ws.on('message', (message) => {
        console.log('Mensaje recibido: %s', message);
        try {
            const parsedMessage = JSON.parse(message.toString()); // Convertir a string antes de parsear
            if (parsedMessage.type === 'joinRoom') {
                const roomId = parsedMessage.roomId;
                clients.set(roomId, ws);
                console.log(`Cliente unido a la sala ${roomId}`);

                // Notificar a los otros jugadores en la sala sobre la nueva conexión
                for (const client of clients.values()) {
                    if (client !== ws) {
                        client.send(JSON.stringify({ type: 'playerJoined' }));
                    }
                }
            }
        } catch (error) {
            console.error('Error al analizar el mensaje:', error);
        }
    });

    ws.on('close', () => {
        console.log('Cliente WebSocket desconectado');
        clients.forEach((clientWs, roomId) => {
            if (clientWs === ws) {
                clients.delete(roomId);
                console.log(`Cliente eliminado de la sala ${roomId}`);
            }
        });
    });

    ws.on('error', (error) => {
        console.error('Error WebSocket:', error);
    });
});

app.post("/api/rooms", (req, res) => {
    let roomId = generateShortId();

    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot: DataSnapshot) => {
        if (snapshot.exists()) {
            roomId = generateShortId();
        }

        const newRoomRef = db.ref(`rooms/${roomId}`);
        newRoomRef.set({
            currentGame: {
                data: {
                    player1Name: "",
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
        });
        res.json({ roomId: roomId });
    });
});

app.put("/api/rooms/:roomId/join", (req, res) => {
    const { roomId } = req.params;
    const { playerName } = req.body;
    const roomRef = db.ref(`rooms/${roomId}`);

    roomRef.once("value", (snapshot: DataSnapshot) => {
        const roomData = snapshot.val();
        if (roomData) {
            if (!roomData.currentGame.data.player1Name) {
                roomRef.update({ 'currentGame/data/player1Name': playerName });
                res.json({ playerNumber: 1 });
            } else if (!roomData.currentGame.data.player2Name) {
                roomRef.update({ 'currentGame/data/player2Name': playerName });
                res.json({ playerNumber: 2 });
            } else {
                res.status(400).json({ message: "Sala llena" });
            }
            notifyRoomUpdate(roomId);
        } else {
            res.status(404).json({ message: "Sala no encontrada" });
        }
    });
});

app.put("/api/rooms/:roomId/move", (req, res) => {
    const { roomId } = req.params;
    const { playerNumber, move } = req.body;
    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot: DataSnapshot) => {
        const roomData = snapshot.val();
        if (roomData) {
            if (playerNumber === 1) {
                roomRef.update({ 'currentGame/data/player1Play': move });
            } else {
                roomRef.update({ 'currentGame/data/player2Play': move });
            }
            if (roomData.currentGame.data.player1Play && roomData.currentGame.data.player2Play) {
                let player1Wins = roomData.currentGame.statistics.player1.wins;
                let player1Losses = roomData.currentGame.statistics.player1.losses;
                let player1Draws = roomData.currentGame.statistics.player1.draws;
                let player2Wins = roomData.currentGame.statistics.player2.wins;
                let player2Losses = roomData.currentGame.statistics.player2.losses;
                let player2Draws = roomData.currentGame.statistics.player2.draws;

                if (roomData.currentGame.data.player1Play === roomData.currentGame.data.player2Play) {
                    player1Draws++;
                    player2Draws++;
                } else if (
                    (roomData.currentGame.data.player1Play === "piedra" && roomData.currentGame.data.player2Play === "tijera") ||
                    (roomData.currentGame.data.player1Play === "tijera" && roomData.currentGame.data.player2Play === "papel") ||
                    (roomData.currentGame.data.player1Play === "papel" && roomData.currentGame.data.player2Play === "piedra")
                ) {
                    player1Wins++;
                    player2Losses++;
                } else {
                    player2Wins++;
                    player1Losses++;
                }

                roomRef.update({
                    'currentGame/statistics/player1': { wins: player1Wins, losses: player1Losses, draws: player1Draws },
                    'currentGame/statistics/player2': { wins: player2Wins, losses: player2Losses, draws: player2Draws },
                    'currentGame/data/player1Play': null,
                    'currentGame/data/player2Play': null,
                    'currentGame/data/gameOver': true,
                });
            }
            res.json({ message: "Movimiento registrado" });
        } else {
            res.status(404).json({ message: "Sala no encontrada" });
        }
    });
});

function generateShortId() {
    let roomId = Math.floor(1000 + Math.random() * 9000);
    return roomId.toString();
}

function notifyRoomUpdate(roomId: string) {
    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot: DataSnapshot) => {
        const roomData = snapshot.val();
        if (roomData) {
            const client = clients.get(roomId);
            if (client) {
                client.send(JSON.stringify({ type: 'roomUpdate', data: roomData }));
            }
        }
    });
}

server.listen(port, () => { // Inicia el servidor HTTP
    console.log(`Servidor iniciado en el puerto ${port}`);
});