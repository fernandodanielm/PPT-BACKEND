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
app.use(cors({
    origin: "https://fernandodanielm.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
}));
app.use(helmet());

const server = http.createServer(app);

// Función para generar roomId numérico aleatorio de 4 dígitos (con verificación de existencia)
async function generateRoomId(): Promise<string> {
    let roomExists = true;
    let roomId: string = ""; // Inicializar roomId con un valor predeterminado

    while (roomExists) {
        roomId = Math.floor(1000 + Math.random() * 9000).toString(); // Asignar un valor a roomId
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
        data: { gameOver: boolean };
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

            // Guardar datos en Firestore
            await firestore.collection("rooms").doc(generatedRoomId).set({
                owner: ownerId,
                users: {
                    [ownerId]: {
                        userName: ownerName,
                        role: "owner"
                    }
                }
            });

            // Guardar datos en RTDB
            await db.ref(`rooms/${generatedRoomId}/users/${ownerId}`).set({
                userName: ownerName,
                role: "owner"
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
 //Iniciar el servidor
server.listen(port, () => {
   console.log(`Servidor iniciado en el puerto ${port}`);
});
