import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as http from "http";
import * as dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";

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
    origin: "http://localhost:1234",
}));
app.use(helmet());

const server = http.createServer(app);

// Función para generar roomId numérico aleatorio de 4 dígitos
function generateRoomId(): number {
    return Math.floor(1000 + Math.random() * 9000);
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
// ... (resto del código)

interface CustomRequest extends Request {
    params: {
        roomId: string;
    };
}



app.post("/api/users", async (req: Request, res: Response) => {
    try {
        const { username } = req.body;

        // Validación del username
        if (!username || typeof username !== 'string' || username.trim() === '') {
            console.error("Error: Username inválido.");
            return res.status(400).json({ message: "Username inválido. Debe ser una cadena no vacía." });
        }

        console.log(`Solicitud de creación de usuario recibida: ${username}`);

        const userRef = await firestore.collection("users").add({ username });

        console.log(`Usuario creado con ID: ${userRef.id}`);

        res.status(201).json({ id: userRef.id, username }); // 201 Created

    } catch (error) {
        if (error instanceof Error) {
            console.error("Error al crear usuario:", error.message);
            if (error.message.includes("permission-denied")) {
                res.status(403).json({ message: "Error de permisos en Firestore.", error: error.message });
            } else if (error.message.includes("firestore")) {
                res.status(500).json({ message: "Error de Firestore.", error: error.message });
            } else {
                res.status(500).json({ message: "Error interno del servidor.", error: error.message });
            }
        } else {
            console.error("Error desconocido al crear usuario:", error);
            res.status(500).json({ message: "Error interno del servidor.", error: "Ocurrió un error desconocido." });
        }
    }
}); // Cierre del bloque catch de /api/users

app.put("/api/users/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { playerName, roomId } = req.body;

        if (!id || typeof id !== 'string' || id.trim() === '') {
            return res.status(400).json({ message: "id inválido. Debe ser una cadena no vacía." });
        }
        if (!playerName || typeof playerName !== 'string' || playerName.trim() === '') {
            return res.status(400).json({ message: "playerName inválido. Debe ser una cadena no vacía." });
        }
        if (!roomId || typeof roomId !== 'string' || roomId.trim() === '') {
            return res.status(400).json({ message: "roomId inválido. Debe ser una cadena no vacía." });
        }

        const roomRef = db.ref(`rooms/${roomId}/currentGame/data`);
        const roomSnapshot = await roomRef.once("value");
        const roomData = roomSnapshot.val();

        if (!roomData) {
            return res.status(404).json({ message: "Sala no encontrada." });
        }

        let playerType: "player1Name" | "player2Name";

        if (!roomData.player1Name) {
            playerType = "player1Name";
            await roomRef.update({ player1Name: playerName });
        } else if (!roomData.player2Name) {
            playerType = "player2Name";
            await roomRef.update({ player2Name: playerName });
        } else {
            return res.status(409).json({ message: "La sala está llena." });
        }

        await firestore.collection("users").doc(id).set({
            playerName: playerName,
            userId: id,
            playerType: playerType
        });

        res.status(200).json({ message: "Datos del usuario guardados correctamente.", playerType });
    } catch (error) {
        if (error instanceof Error) {
            console.error("Error:", error.message);
            res.status(500).json({ message: "Error interno del servidor", error: error.message });
        } else {
            console.error("Error desconocido:", error);
            res.status(500).json({ message: "Error interno del servidor", error: "Ocurrió un error desconocido." });
        }
    }
});



app.post("/api/rooms", async (req: Request, res: Response) => {
    try {
        const { id } = req.body;

        if (!id || typeof id !== 'string' || id.trim() === '') {
            return res.status(400).json({ message: "id inválido. Debe ser una cadena no vacía." });
        }

        const userDoc = await firestore.collection("users").doc(id).get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        const username = userDoc.data()?.username;
        const roomId = generateRoomId().toString();

        await firestore.collection("rooms").doc(roomId).set({
            owner: username,
            guest: null,
        });

        await db.ref(`rooms/${roomId}`).set({
            currentGame: {
                data: {
                    player1Play: null,
                    player2Play: null,
                    gameOver: false,
                    player1Name: username,
                    player2Name: null,
                },
                statistics: {
                    player1: { wins: 0, losses: 0, draws: 0 },
                    player2: { wins: 0, losses: 0, draws: 0 },
                },
            },
            notifications: [],
        });

        console.log(`Sala creada con ID: ${roomId}`);
        res.json({ shortId: roomId, rtdbRoomId: roomId }); // Corrección: devolver shortId y rtdbRoomId
    } catch (error) {
        if (error instanceof Error) {
            console.error("Error:", error.message);
            res.status(500).json({ message: "Error interno del servidor", error: error.message });
        } else {
            console.error("Error desconocido:", error);
            res.status(500).json({ message: "Error interno del servidor", error: "Ocurrió un error desconocido." });
        }
    }
});

// ... (resto del código)

app.put("/api/rooms/:roomId/join", async (req: Request, res: Response) => {
    try {
        const { roomId } = req.params;
        const { playerName, id } = req.body;

        console.log(`Intento de unión a la sala: roomId=${roomId}, playerName=${playerName}, userId=${id}`);

        // Validaciones básicas
        if (!roomId || typeof roomId !== 'string' || roomId.trim() === '') {
            console.log("roomId inválido");
            return res.status(400).json({ message: "roomId inválido. Debe ser una cadena no vacía." });
        }

        if (!playerName || typeof playerName !== 'string' || playerName.trim() === '') {
            console.log("playerName inválido");
            return res.status(400).json({ message: "playerName inválido. Debe ser una cadena no vacía." });
        }

        if (!id || typeof id !== 'string' || id.trim() === '') {
            console.log("userId inválido");
            return res.status(400).json({ message: "userId inválido. Debe ser una cadena no vacía." });
        }

        // Validación de userId en Firestore
        const userDoc = await firestore.collection("users").doc(id).get();
        if (!userDoc.exists) {
            console.log(`userId ${id} no encontrado en Firestore`);
            return res.status(400).json({ message: "userId no encontrado." });
        }

        // Transacción para asegurar atomicidad
        const rtdbRoomData = await firestore.runTransaction(async (transaction) => {
            const roomDoc = await transaction.get(firestore.collection("rooms").doc(roomId));

            if (!roomDoc.exists) {
                console.log(`Sala ${roomId} no encontrada`);
                throw { status: 404, message: "Sala no encontrada" };
            }

            const roomData = roomDoc.data();

            if (roomData?.guest) {
                console.log(`Sala ${roomId} ya tiene un invitado`);
                throw { status: 409, message: "La sala ya tiene un invitado" };
            }

            transaction.update(firestore.collection("rooms").doc(roomId), {
                guest: playerName,
            });

            await db.ref(`rooms/${roomId}/currentGame/data`).update({
                player2Name: playerName,
            });

            const rtdbRoom = await db.ref(`rooms/${roomId}`).get();
            return rtdbRoom.val().currentGame;
        });

        console.log(`Jugador ${playerName} se unió a la sala ${roomId}`);
        res.json({ currentGame: rtdbRoomData });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
            // Verificar si error.status es un número
            if (typeof error.status === 'number') {
                res.status(error.status).json({ message: error.message });
            } else {
                // Manejar el caso en que error.status no es un número
                console.error("Error: status no es un número", error);
                res.status(500).json({ message: "Error interno del servidor", error: "status no válido" });
            }
        } else if (error instanceof Error) {
            console.error("Error:", error.message);
            res.status(500).json({ message: "Error interno del servidor", error: error.message });
        } else {
            console.error("Error desconocido:", error);
            res.status(500).json({ message: "Error interno del servidor", error: "Ocurrió un error desconocido." });
        }
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
