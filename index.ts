import express, { Request, Response } from "express";
import admin from "firebase-admin";
import * as http from "http";
import * as dotenv from "dotenv";
import cors from "cors"; // Importa CORS
import helmet from "helmet"

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
const firestore = admin.firestore();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
    origin: 'http://localhost:3000', // Reemplaza con tu origen
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
}));
app.use(helmet())

const server = http.createServer(app);

interface CustomRequest extends Request {
    params: {
        roomId: string;
    };
}

function generateRtdbRoomId(): string {
    return db.ref().push().key as string;
}

interface Updates {
    currentGame?: {
        statistics: {
            player1: { wins: number; losses: number; draws: number };
            player2: { wins: number; losses: number; draws: number };
        };
        data: { gameOver: boolean };
    };
}

// Crear usuario en Firestore
app.post("/api/users", async (req: Request, res: Response) => {
    try {
        const { username } = req.body;
        const userRef = await firestore.collection("users").add({ username });
        res.json({ id: userRef.id, username });
    } catch (error) {
        console.error("Error al crear el usuario:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});

// Crear sala a nombre del usuario
app.post("/api/rooms", async (req: Request, res: Response) => {
    try {
        const { userId } = req.body; // Recibe el userId en lugar del username
        const userDoc = await firestore.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        const username = userDoc.data()?.username;
        const rtdbRoomId = generateRtdbRoomId();

        // Crear sala en Firestore con el userId como ID
        await firestore.collection("rooms").doc(userId).set({
            rtdbRoomId,
            owner: username,
        });

        // Crear sala en Realtime Database
        await db.ref(`rooms/${userId}`).set({ // Usar userId como ID de la sala
            currentGame: {
                data: {
                    player1Play: null,
                    player2Play: null,
                    gameOver: false,
                },
                statistics: {
                    player1: { wins: 0, losses: 0, draws: 0 },
                    player2: { wins: 0, losses: 0, draws: 0 },
                },
            },
            notifications: [],
        });

        res.json({ roomId: userId, rtdbRoomId }); // Retornar userId como roomId
    } catch (error) {
        console.error("Error al crear la sala:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});

// Unirse a la sala
app.put("/api/rooms/:roomId/join", async (req: CustomRequest, res: Response) => {
    try {
        const roomId = req.params.roomId; // Ahora roomId es userId
        const { playerName, userId } = req.body;

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

                // Firestore: Actualizar sala con guestId
                await firestore.collection("rooms").doc(roomId).update({
                    guestId: userId,
                });

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

app.put("/api/rooms/:roomId/move", async (req: CustomRequest, res: Response) => {
    try {
        const roomId = req.params.roomId;
        const { playerNumber, move } = req.body;

        if (!roomId || !/^\d{4}$/.test(roomId)) {
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
                // Lógica del juego
                const player1Move = roomData.currentGame.data.player1Play;
                const player2Move = roomData.currentGame.data.player2Play;

                let result;
                if (player1Move === player2Move) {
                    result = "draw";
                } else if (
                    (player1Move === "piedra" && player2Move === "tijera") ||
                    (player1Move === "papel" && player2Move === "piedra") ||
                    (player1Move === "tijera" && player2Move === "papel")
                ) {
                    result = "player1Wins";
                } else {
                    result = "player2Wins";
                }

                // Actualización de estadísticas y estado del juego
                let updates: Updates = {}; // Inicializamos updates con la interfaz Updates

                if (result === "player1Wins") {
                    updates.currentGame = {
                        statistics: {
                            player1: { wins: roomData.currentGame.statistics.player1.wins + 1, losses: roomData.currentGame.statistics.player1.losses, draws: roomData.currentGame.statistics.player1.draws },
                            player2: { wins: roomData.currentGame.statistics.player2.losses + 1, losses: roomData.currentGame.statistics.player2.wins, draws: roomData.currentGame.statistics.player2.draws }
                        },
                        data: { gameOver: true }
                    };
                } else if (result === "player2Wins") {
                    updates.currentGame = {
                        statistics: {
                            player1: { wins: roomData.currentGame.statistics.player1.wins, losses: roomData.currentGame.statistics.player1.losses + 1, draws: roomData.currentGame.statistics.player1.draws },
                            player2: { wins: roomData.currentGame.statistics.player2.wins + 1, losses: roomData.currentGame.statistics.player2.losses, draws: roomData.currentGame.statistics.player2.draws }
                        },
                        data: { gameOver: true }
                    };
                } else {
                    updates.currentGame = {
                        statistics: {
                            player1: { wins: roomData.currentGame.statistics.player1.wins, losses: roomData.currentGame.statistics.player1.losses, draws: roomData.currentGame.statistics.player1.draws + 1 },
                            player2: { wins: roomData.currentGame.statistics.player2.wins, losses: roomData.currentGame.statistics.player2.losses, draws: roomData.currentGame.statistics.player2.draws }
                        },
                        data: { gameOver: true }
                    };
                }

                if (updates.currentGame) {
                    await roomRef.update(updates.currentGame);
                }

                if (updates.currentGame) {
                    const currentGame = updates.currentGame;

                    db.ref(`rooms/${roomId}/notifications`).push({
                        type: "gameOver",
                        currentGame: {
                            data: {
                                player1Play: roomData.currentGame.data.player1Play,
                                player2Play: roomData.currentGame.data.player2Play,
                                gameOver: true,
                            },
                            statistics: {
                                player1: {
                                    wins: currentGame.statistics.player1.wins,
                                    losses: currentGame.statistics.player1.losses,
                                    draws: currentGame.statistics.player1.draws,
                                },
                                player2: {
                                    wins: currentGame.statistics.player2.wins,
                                    losses: currentGame.statistics.player2.losses,
                                    draws: currentGame.statistics.player2.draws,
                                },
                            },
                        },
                    });
                }

                res.json({ message: "Movimiento registrado y juego actualizado", result });
                console.log(`Movimiento registrado en la sala ${roomId}, resultado: ${result}`);
            } else {
                res.json({ message: "Movimiento registrado" });
                console.log(`Movimiento registrado en la sala ${roomId}`);
            }
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