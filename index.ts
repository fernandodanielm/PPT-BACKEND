import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as http from "http";
import * as dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import { getDatabase ,ref, update, get } from 'firebase/database';
import { initializeApp } from "firebase/app";
import {firebaseConfig} from "./firebaseconfig"

dotenv.config();
const shortid = require("shortid");
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
const firebaseApp = initializeApp(firebaseConfig);
const db = admin.database();
const firestore = admin.firestore();
const rtdb = getDatabase(firebaseApp);
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
// Configuración de CORS - Se permiten solicitudes solo desde tu dominio de GitHub Pages
app.use(cors({
    origin: "https://fernandodanielm.github.io",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Asegúrate de incluir OPTIONS
    allowedHeaders: ["Content-Type"], // Especifica las cabeceras permitidas
}));
app.use(helmet());

const server = http.createServer(app);

// Definir el tipo Jugada aquí
type Jugada = "piedra" | "papel" | "tijera";

// Función para generar roomId numérico aleatorio de 4 dígitos (con verificación de existencia en Firestore)
async function generateRoomId(): Promise<string> {
    let roomExists = true;
    let roomId: string = "";

    while (roomExists) {
        roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const roomDoc = await firestore.collection("rooms").doc(roomId).get();
        roomExists = roomDoc.exists;
    }
    return roomId;
}

interface Updates {
    currentGame?: {
        statistics: {
            player1: { wins: number; losses: number; draws: number };
            player2: { wins: number; losses: number; draws: number };
        };
        data: {
            gameOver: boolean;
            player1Move: Jugada | null;
            player2Move: Jugada | null;
            result: "draw" | "ownerWins" | "guestWins" | null;
        };
    };
}

interface CustomRequest extends Request {
    params: {
        roomId: string;
    };
}

app.post("/api/guardardatos", async (req, res) => {
    try {
        const { ownerId, ownerName, guestId, guestName, roomId } = req.body;
        let generatedRoomId = roomId;

        if (!roomId) {
            // Si no hay roomId, es el propietario creando una nueva sala
            generatedRoomId = await generateRoomId();

            // Guardar datos de la sala en Firestore
            await firestore.collection("rooms").doc(generatedRoomId).set({
                owner: ownerId,
                users: {
                    [ownerId]: {
                        userName: ownerName,
                        role: "owner"
                    }
                }
            });

            // Guardar datos de la sala en RTDB
            const rtdbRoomRef = db.ref(`rooms/${generatedRoomId}`);
            await rtdbRoomRef.set({
                users: {
                    [ownerId]: {
                        userName: ownerName,
                        role: "owner"
                    }
                },
                games: {
                    current: { // Inicializar el nodo 'current' dentro de 'games'
                        player1Move: null,
                        player2Move: null,
                        result: null,
                        gameOver: false,
                    }
                }
            });
        }

        if (guestId) {
            // Si hay guestId, es un invitado uniéndose a una sala existente

            const roomRef = firestore.collection("rooms").doc(generatedRoomId);
            const roomDoc = await roomRef.get();

            if (!roomDoc.exists) {
                return res.status(404).send("Sala no encontrada");
            }

            // Guardar datos del invitado en Firestore
            await roomRef.update({
                [`users.${guestId}`]: {
                    userName: guestName,
                    role: "guest"
                }
            });

            // Guardar datos del invitado en RTDB
            await db.ref(`rooms/${generatedRoomId}/users/${guestId}`).set({
                userName: guestName,
                role: "guest"
            });

            // Inicializar jugadas del invitado en RTDB (si la sala ya existe)
            const gameRef = db.ref(`rooms/${generatedRoomId}/games/current`);
            const gameSnapshot = await gameRef.get();
            if (gameSnapshot.exists()) {
                await gameRef.update({ player2Move: null, result: null, gameOver: false });
            } else {
                await gameRef.set({ player1Move: null, player2Move: null, result: null, gameOver: false });
            }
        }

        res.status(200).json({ roomId: generatedRoomId });
    } catch (error) {
        console.error("Error al guardar datos:", error);
        res.status(500).send("Error interno del servidor");
    }
});


app.put("/api/rooms/:roomId/move", async (req: CustomRequest, res: Response) => {
    try {
        console.log("--- Inicio de la solicitud PUT /api/rooms/:roomId/move ---");
        console.log("roomId:", req.params.roomId);
        console.log("req.body:", req.body);

        const roomId = req.params.roomId;
        const { playerNumber, move } = req.body;

        // Validación básica de los datos recibidos
        if (!roomId || !playerNumber || !move) {
            console.error("Datos incompletos en la solicitud.");
            return res.status(400).json({ message: "Datos incompletos." });
        }

        // Validación del número de jugador
        if (playerNumber !== 1 && playerNumber !== 2) {
            console.error("Número de jugador inválido:", playerNumber);
            return res.status(400).json({ message: "Número de jugador inválido." });
        }

        // Validación del movimiento
        const validMoves = ["piedra", "papel", "tijera"];
        if (!validMoves.includes(move)) {
            console.error("Movimiento inválido:", move);
            return res.status(400).json({ message: "Movimiento inválido." });
        }

        // Obtener el estado actual del juego desde la base de datos
        const gameRef = ref(rtdb, `rooms/${roomId}/games/current`);
        const snapshot = await get(gameRef);
        const gameData = snapshot.val();

        if (!gameData) {
            console.error("No se encontró el juego en la base de datos.");
            return res.status(404).json({ message: "Juego no encontrado." });
        }

        // Verificar si el jugador ya hizo su movimiento
        if (playerNumber === 1 && gameData.player1Move) {
            console.error("El jugador 1 ya hizo su movimiento.");
            return res.status(400).json({ message: "El jugador 1 ya hizo su movimiento." });
        }
        if (playerNumber === 2 && gameData.player2Move) {
            console.error("El jugador 2 ya hizo su movimiento.");
            return res.status(400).json({ message: "El jugador 2 ya hizo su movimiento." });
        }

        // Actualizar el movimiento del jugador en la base de datos
        const updateData: any = {};
        if (playerNumber === 1) {
            updateData.player1Move = move;
        } else {
            updateData.player2Move = move;
        }

        await update(gameRef, updateData);

        // Obtener el estado actualizado del juego después de la actualización
        const updatedSnapshot = await get(gameRef);
        const updatedGameData = updatedSnapshot.val();

        // Verificar si ambos jugadores han hecho su movimiento
        if (updatedGameData.player1Move && updatedGameData.player2Move) {
            // Lógica para determinar el ganador
            const player1Move = updatedGameData.player1Move;
            const player2Move = updatedGameData.player2Move;

            let result: "draw" | "ownerWins" | "guestWins";

            if (player1Move === player2Move) {
                result = "draw";
            } else if (
                (player1Move === "piedra" && player2Move === "tijera") ||
                (player1Move === "papel" && player2Move === "piedra") ||
                (player1Move === "tijera" && player2Move === "papel")
            ) {
                result = "ownerWins";
            } else {
                result = "guestWins";
            }

            // Actualizar el resultado y gameOver en la base de datos
            await update(gameRef, {
                result: result,
                gameOver: true,
            });

            console.log("Resultado del juego:", result);
        }

        console.log("--- Fin de la solicitud PUT /api/rooms/:roomId/move ---");
        res.json({ message: "Movimiento registrado con éxito." });

    } catch (error) {
        console.error("Error en /api/rooms/:roomId/move:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});


app.post("/api/rooms/:roomId/reset", async (req: CustomRequest, res: Response) => {
    try {
        const roomId = req.params.roomId;

        if (!roomId || !/^\d{4}$/.test(roomId)) {
            return res.status(400).json({ message: "roomId inválido." });
        }

        const gameRef = db.ref(`rooms/${roomId}/games/current`);
        await gameRef.update({
            player1Move: null,
            player2Move: null,
            result: null,
            gameOver: false,
        });

        res.json({ message: `Juego en la sala ${roomId} reseteado.` });
        console.log(`Juego en la sala ${roomId} reseteado.`);

    } catch (error) {
        console.error("Error al resetear el juego:", error);
        res.status(500).json({ message: "Error interno al resetear el juego." });
    }
});

// Iniciar el servidor
server.listen(port, () => {
    console.log(`Servidor iniciado en el puerto ${port}`);
});