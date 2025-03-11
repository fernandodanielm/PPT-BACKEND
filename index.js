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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const ws_1 = require("ws");
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
const wss = new ws_1.WebSocketServer({ server, path: "/ws" }); // Especificar la ruta '/ws'
const clients = new Map();
wss.on("connection", (ws) => {
    console.log("Cliente WebSocket conectado");
    ws.on("message", (message) => {
        console.log("Mensaje recibido: %s", message);
        try {
            const parsedMessage = JSON.parse(message.toString());
            if (parsedMessage.type === "joinRoom") {
                const roomId = parsedMessage.roomId;
                clients.set(roomId, ws);
                console.log(`Cliente unido a la sala ${roomId}`); // Notificar a los otros jugadores en la sala sobre la nueva conexión
                for (const client of clients.values()) {
                    if (client !== ws) {
                        client.send(JSON.stringify({ type: "playerJoined" }));
                    }
                }
            }
        }
        catch (error) {
            console.error("Error al analizar el mensaje:", error);
        }
    });
    ws.on("close", () => {
        console.log("Cliente WebSocket desconectado");
        clients.forEach((clientWs, roomId) => {
            if (clientWs === ws) {
                clients.delete(roomId);
                console.log(`Cliente eliminado de la sala ${roomId}`);
            }
        });
    });
    ws.on("error", (error) => {
        console.error("Error WebSocket:", error);
    });
});
app.post("/api/rooms", async (req, res) => {
    try {
        let roomId = generateShortId();
        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = await roomRef.once("value");
        if (snapshot.exists()) {
            roomId = generateShortId();
        }
        const newRoomRef = db.ref(`rooms/${roomId}`);
        // Obtener el nombre del jugador del cuerpo de la solicitud
        const { playerName } = req.body;
        const newRoom = {
            currentGame: {
                data: {
                    player1Name: "", // Asignar el nombre del jugador
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
        await newRoomRef.set(newRoom);
        // Incluir currentGame en la respuesta
        res.json({ roomId: roomId, currentGame: newRoom.currentGame });
    }
    catch (error) {
        console.error("Error al crear la sala:", error);
        // No se envía res.status(500)
        res.status(500).json({ message: "Error interno del servidor" }); // Puedes enviar el mensaje de error para depuración
    }
});
app.put("/api/rooms/:roomId/join", async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const { nombre } = req.body;
        const roomRef = db.ref(`rooms/${roomId}/currentGame/data`);
        const snapshot = await roomRef.once("value");
        if (snapshot.exists()) {
            await roomRef.update({ player2Name: nombre });
            const updatedRoom = await db.ref(`rooms/${roomId}/currentGame`).once('value');
            res.json({ currentGame: updatedRoom.val() });
        }
        else {
            res.status(404).json({ message: "Sala no encontrada." });
        }
    }
    catch (error) {
        console.error("Error al unirse a la sala:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});
app.put("/api/rooms/:roomId/move", async (req, res) => {
    try {
        const { roomId } = req.params;
        const { playerNumber, move } = req.body;
        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = await roomRef.once("value");
        const roomData = snapshot.val();
        if (roomData) {
            if (playerNumber === 1) {
                await roomRef.update({ "currentGame/data/player1Play": move });
            }
            else {
                await roomRef.update({ "currentGame/data/player2Play": move });
            }
            if (roomData.currentGame.data.player1Play &&
                roomData.currentGame.data.player2Play) {
                let player1Wins = roomData.currentGame.statistics.player1.wins;
                let player1Losses = roomData.currentGame.statistics.player1.losses;
                let player1Draws = roomData.currentGame.statistics.player1.draws;
                let player2Wins = roomData.currentGame.statistics.player2.wins;
                let player2Losses = roomData.currentGame.statistics.player2.losses;
                let player2Draws = roomData.currentGame.statistics.player2.draws;
                if (roomData.currentGame.data.player1Play ===
                    roomData.currentGame.data.player2Play) {
                    player1Draws++;
                    player2Draws++;
                }
                else if ((roomData.currentGame.data.player1Play === "piedra" &&
                    roomData.currentGame.data.player2Play === "tijera") ||
                    (roomData.currentGame.data.player1Play === "tijera" &&
                        roomData.currentGame.data.player2Play === "papel") ||
                    (roomData.currentGame.data.player1Play === "papel" &&
                        roomData.currentGame.data.player2Play === "piedra")) {
                    player1Wins++;
                    player2Losses++;
                }
                else {
                    player2Wins++;
                    player1Losses++;
                }
                await roomRef.update({
                    "currentGame/statistics/player1": {
                        wins: player1Wins,
                        losses: player1Losses,
                        draws: player1Draws,
                    },
                    "currentGame/statistics/player2": {
                        wins: player2Wins,
                        losses: player2Losses,
                        draws: player2Draws,
                    },
                    "currentGame/data/player1Play": null,
                    "currentGame/data/player2Play": null,
                    "currentGame/data/gameOver": true,
                });
            }
            res.json({ message: "Movimiento registrado" });
        }
        else {
            res.status(404).json({ message: "Sala no encontrada" });
        }
    }
    catch (error) {
        console.error("Error al registrar el movimiento:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});
function generateShortId() {
    let roomId = Math.floor(1000 + Math.random() * 9000);
    return roomId.toString();
}
function notifyRoomUpdate(roomId) {
    const roomRef = db.ref(`rooms/${roomId}`);
    roomRef.once("value", (snapshot) => {
        const roomData = snapshot.val();
        if (roomData) {
            const client = clients.get(roomId);
            if (client) {
                client.send(JSON.stringify({ type: "roomUpdate", data: roomData }));
            }
        }
    });
}
server.listen(port, () => {
    // Inicia el servidor HTTP
    console.log(`Servidor iniciado en el puerto ${port}`);
});
//# sourceMappingURL=index.js.map