import express from "express";
import { json } from "body-parser";
import { DataSnapshot } from "firebase-admin/database";
import cors from "cors";
import admin from "firebase-admin";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "http";
import * as dotenv from "dotenv";

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

// Configuración del servidor WebSocket
const wss = new WebSocketServer({ server, path: "/ws" }); // Especificar la ruta '/ws'
const clients = new Map<string, WebSocket>();

wss.on("connection", (ws) => {
  console.log("Cliente WebSocket conectado");

  ws.on("message", (message) => {
    console.log("Mensaje recibido: %s", message);

    try {
      const parsedMessage = JSON.parse(message.toString());

      if (parsedMessage.type === "joinRoom") {
        const roomId = parsedMessage.roomId;
        clients.set(roomId, ws);
        console.log(`Mensaje joinRoom recibido para la sala ${roomId}`); // Agregar log
        console.log(`Cliente unido a la sala ${roomId}`);

        for (const client of clients.values()) {
          if (client !== ws) {
            client.send(JSON.stringify({ type: "playerJoined" }));
          }
        }
      }
    } catch (error) {
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

// Rutas de la API
app.post("/api/rooms", async (req, res) => {
  try {
    let roomId = generateShortId();
    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once("value");

    if (snapshot.exists()) {
      roomId = generateShortId();
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
    notifyRoomUpdate(roomId);

    if (snapshot.exists()) {
      const roomData = snapshot.val();
      if (!roomData.player2Name) {
        await roomRef.update({ player2Name: playerName });
        const updatedRoom = await db.ref(`rooms/${roomId}/currentGame`).once('value');
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

// Funciones auxiliares
function generateShortId() {
  let roomId = Math.floor(1000 + Math.random() * 9000);
  return roomId.toString();
}

function notifyRoomUpdate(roomId: string) {
  const roomRef = db.ref(`rooms/${roomId}`);
  roomRef.once("value", (snapshot: DataSnapshot) => {
    const roomData = snapshot.val();
    if (roomData) {
      const ws = clients.get(roomId); // Obtener el WebSocket del cliente
      if (ws) {
        ws.send(JSON.stringify({ type: "roomUpdate", data: roomData }));
      }
    }
  });
}

// Iniciar el servidor
server.listen(port, () => {
  console.log(`Servidor iniciado en el puerto ${port}`);
});