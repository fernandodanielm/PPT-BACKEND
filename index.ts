import express from "express";
import { json } from "body-parser";
import cors from "cors";
import admin from "firebase-admin";
import * as http from "http";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from 'uuid'; // Importa uuidv4

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

// Rutas de la API
app.post("/api/rooms", async (req, res) => {
  try {
      // Generar roomId alfanumérico usando uuidv4
      let roomId = uuidv4().replace(/-/g, '').substring(0, 5); // Cambiado a let

      const roomRef = db.ref(`rooms/${roomId}`);
      const snapshot = await roomRef.once("value");

      if (snapshot.exists()) {
          // Generar un nuevo roomId si ya existe
          roomId = uuidv4().replace(/-/g, '').substring(0, 8); // Se reasigna roomId
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
  } catch (error) {
      console.error("Error al crear la sala:", error);
      res.status(500).json({ message: "Error interno del servidor" });
  }
});


app.put("/api/rooms/:roomId/join", async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const { playerName } = req.body;
        const roomRef = db.ref(`rooms/${roomId}/currentGame/data`);
        const snapshot = await roomRef.once("value");

        if (snapshot.exists()) {
            const roomData = snapshot.val();
            if (!roomData.player2Name) {
                await roomRef.update({ player2Name: playerName });

                // Agrega un listener para detectar cambios en player2Name
                db.ref(`rooms/${roomId}/currentGame/data/player2Name`).on(
                    "value",
                    (snapshot) => {
                        if (snapshot.exists()) {
                            const newPlayer2Name = snapshot.val();
                            // Notificar a través de Realtime Database
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
            } else {
                res.status(409).json({ message: "La sala ya está llena." });
            }
        } else {
            res.status(404).json({ message: "Sala no encontrada." });
        }
    } catch (error) {
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
            } else {
                await roomRef.update({ "currentGame/data/player2Play": move });
            }

            if (
                roomData.currentGame.data.player1Play &&
                roomData.currentGame.data.player2Play
            ) {
                let player1Wins = roomData.currentGame.statistics.player1.wins;
                let player1Losses = roomData.currentGame.statistics.player1.losses;
                let player1Draws = roomData.currentGame.statistics.player1.draws;
                let player2Wins = roomData.currentGame.statistics.player2.wins;
                let player2Losses = roomData.currentGame.statistics.player2.losses;
                let player2Draws = roomData.currentGame.statistics.player2.draws;

                if (
                    roomData.currentGame.data.player1Play ===
                    roomData.currentGame.data.player2Play
                ) {
                    player1Draws++;
                    player2Draws++;
                } else if (
                    (roomData.currentGame.data.player1Play === "piedra" &&
                        roomData.currentGame.data.player2Play === "tijera") ||
                    (roomData.currentGame.data.player1Play === "tijera" &&
                        roomData.currentGame.data.player2Play === "papel") ||
                    (roomData.currentGame.data.player1Play === "papel" &&
                        roomData.currentGame.data.player2Play === "piedra")
                ) {
                    player1Wins++;
                    player2Losses++;
                } else {
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

                // Notificar a través de Realtime Database cuando el juego termina
                db.ref(`rooms/${roomId}/notifications`).push({
                    type: "gameOver",
                    currentGame: roomData.currentGame,
                });
            }

            res.json({ message: "Movimiento registrado" });
        } else {
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