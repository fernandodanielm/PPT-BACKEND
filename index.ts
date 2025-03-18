// backend/app.ts
import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as http from "http";
import * as dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";

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

const db = admin.database();
const firestore = admin.firestore();

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
                await gameRef.update({ player2Move: null });
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
        const roomId = req.params.roomId;
        const { playerNumber, move } = req.body;

        if (!roomId || !/^\d{4}$/.test(roomId)) {
            console.error(`roomId inválido: ${roomId}`);
            return res.status(400).json({ message: "roomId inválido. Debe ser un número de 4 dígitos." });
        }

        const gameRef = db.ref(`rooms/${roomId}/games/current`);

        // Actualizar el movimiento ANTES de obtener los datos para la verificación
        const updatePayload: { player1Move?: Jugada | null; player2Move?: Jugada | null } = {};
        if (playerNumber === 1) {
            updatePayload.player1Move = move as Jugada; // Hacer un type assertion aquí
        } else if (playerNumber === 2) {
            updatePayload.player2Move = move as Jugada; // Hacer un type assertion aquí
        }
        await gameRef.update(updatePayload);
        console.log(`Movimiento del jugador ${playerNumber} registrado en la sala ${roomId}: ${move}`);

        const gameSnapshot = await gameRef.get();
        const gameData = gameSnapshot.val();

        if (gameData && gameData.player1Move && gameData.player2Move) {
            let result: "draw" | "ownerWins" | "guestWins";
            if (gameData.player1Move === gameData.player2Move) {
                result = "draw";
            } else if (
                (gameData.player1Move === "piedra" && gameData.player2Move === "tijera") ||
                (gameData.player1Move === "papel" && gameData.player2Move === "piedra") ||
                (gameData.player1Move === "tijera" && gameData.player2Move === "papel")
            ) {
                result = "ownerWins"; // Asumiendo que playerNumber 1 es el owner
            } else {
                result = "guestWins"; // Asumiendo que playerNumber 2 es el guest
            }

            await gameRef.update({
                result: result,
                gameOver: true,
            });

            res.json({ message: "Movimiento registrado y juego actualizado", result });
            console.log(`Resultado del juego en la sala ${roomId}: ${result}`);
        } else {
            res.json({ message: "Movimiento registrado, esperando al otro jugador." });
            console.log(`Movimiento registrado en la sala ${roomId}, esperando al otro jugador.`);
        }
    } catch (error) {
        console.error("Error al registrar el movimiento:", error);
        res.status(500).json({ message: "Error interno del servidor" });
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