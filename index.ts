import express, { Request, Response, NextFunction, RequestHandler } from "express"; // Import RequestHandler
import { json } from "body-parser";
import cors from "cors";
import admin from "firebase-admin";
import * as http from "http";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)
    : null;

if (!serviceAccount) {
    console.error(
        "La variable de entorno FIREBASE_SERVICE_ACCOUNT no está definida o no es un JSON válido."
    );
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

const server = http.createServer(app);

interface CustomRequest extends Request {
    params: {
        roomId: string;
    };
}

function generateNumericRoomId(): number {
    return Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
}

// Rutas de la API
app.post("/api/rooms", async (req: Request, res: Response) => { // Use Request and Response types
    try {
        let roomId = generateNumericRoomId().toString();

        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = await roomRef.once("value");

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

        await newRoomRef.set(newRoom);
        res.json({ roomId: roomId, currentGame: newRoom.currentGame });
        console.log(`Sala creada con roomId: ${roomId}`);
    } catch (error) {
        console.error("Error al crear la sala:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});

app.put("/api/rooms/:roomId/join", async (req: CustomRequest, res: Response) => { // Use Request and Response types
    try {
        const roomId = req.params.roomId;
        const { playerName } = req.body;

        if (!roomId || !/^\d{4}$/.test(roomId)) { // Improved validation
            console.error(`roomId inválido: ${roomId}`);
            return res.status(400).json({ message: "roomId inválido. Debe ser un número de 4 dígitos." });
        }

        const roomRef = db.ref(`rooms/${roomId}/currentGame/data`);
        const snapshot = await roomRef.once("value");

        if (snapshot.exists()) {
            const roomData = snapshot.val();
            if (!roomData.player2Name) {
                await roomRef.update({ player2Name: playerName });

                db.ref(`rooms/${roomId}/currentGame/data/player2Name`).on(
                    "value",
                    (snapshot) => {
                        if (snapshot.exists()) {
                            const newPlayer2Name = snapshot.val();
                            db.ref(`rooms/${roomId}/notifications`).push({
                                type: "playerJoined",
                                player2Name: newPlayer2Name,
                            });
                        }
                    }
                );

                const updatedRoom = await db
                    .ref(`rooms/${roomId}/currentGame`)
                    .once("value");
                res.json({ currentGame: updatedRoom.val() });
                console.log(`Jugador ${playerName} se unió a la sala ${roomId}`);
            } else {
                console.log(`La sala ${roomId} ya está llena.`);
                res.status(409).json({ message: "La sala ya está llena." });
            }
        } else {
            console.log(`Sala ${roomId} no encontrada.`);
            res.status(404).json({ message: "Sala no encontrada." });
        }
    } catch (error) {
        console.error("Error al unirse a la sala:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

app.put("/api/rooms/:roomId/move", async (req: CustomRequest, res: Response) => { // Use Request and Response types
    try {
        const roomId = req.params.roomId;
        const { playerNumber, move } = req.body;

        if (!roomId || !/^\d{4}$/.test(roomId)) { // Improved validation
            console.error(`roomId inválido: ${roomId}`);
            return res.status(400).json({ message: "roomId inválido. Debe ser un número de 4 dígitos." });
        }

        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = await roomRef.once("value");
        const roomData = snapshot.val();

        if (roomData) {
            if (playerNumber === 1) {
                await roomRef.update({ "currentGame/data/player1Play": move });
            } else {
                await roomRef.update({ "currentGame/data/player2Play": move });
            }

            if (roomData.currentGame.data.player1Play && roomData.currentGame.data.player2Play) {
                // ... (lógica del juego)
                await roomRef.update({
                    // ... (actualización de estadísticas y estado del juego)
                });

                db.ref(`rooms/${roomId}/notifications`).push({
                    type: "gameOver",
                    currentGame: roomData.currentGame,
                });
            }

            res.json({ message: "Movimiento registrado" });
            console.log(`Movimiento registrado en la sala ${roomId}`);
        } else {
            console.log(`Sala ${roomId} no encontrada.`);
            res.status(404).json({ message: "Sala no encontrada" });
        }
    } catch (error) {
        console.error("Error al registrar el movimiento:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});

// Iniciar el servidor
server.listen(port, () => {
    console.log(`Servidor iniciado en el puerto ${port}`);
});