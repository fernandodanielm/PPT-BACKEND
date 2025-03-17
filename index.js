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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const admin = __importStar(require("firebase-admin"));
const http = __importStar(require("http"));
const dotenv = __importStar(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
dotenv.config();
const shortid = require("shortid");
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
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
const firestore = admin.firestore();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.use(express_1.default.json());
// Configuración de CORS - Se permiten solicitudes solo desde tu dominio de GitHub Pages
app.use((0, cors_1.default)({
    origin: "https://fernandodanielm.github.io",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Asegúrate de incluir OPTIONS
    allowedHeaders: ["Content-Type"], // Especifica las cabeceras permitidas
}));
app.use((0, helmet_1.default)());
const server = http.createServer(app);
// Función para generar roomId numérico aleatorio de 4 dígitos (con verificación de existencia en Firestore)
function generateRoomId() {
    return __awaiter(this, void 0, void 0, function* () {
        let roomExists = true;
        let roomId = "";
        while (roomExists) {
            roomId = Math.floor(1000 + Math.random() * 9000).toString();
            const roomDoc = yield firestore.collection("rooms").doc(roomId).get();
            roomExists = roomDoc.exists;
        }
        return roomId;
    });
}
app.post("/api/guardardatos", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { ownerId, ownerName, guestId, guestName, roomId } = req.body;
        let generatedRoomId = roomId;
        if (!roomId) {
            // Si no hay roomId, es el propietario creando una nueva sala
            generatedRoomId = yield generateRoomId();
            // Guardar datos de la sala en Firestore
            yield firestore.collection("rooms").doc(generatedRoomId).set({
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
            yield rtdbRoomRef.set({
                users: {
                    [ownerId]: {
                        userName: ownerName,
                        role: "owner"
                    }
                },
                games: {} // Inicializar el nodo 'games' como un objeto vacío
            });
        }
        if (guestId) {
            // Si hay guestId, es un invitado uniéndose a una sala existente
            const roomRef = firestore.collection("rooms").doc(generatedRoomId);
            const roomDoc = yield roomRef.get();
            if (!roomDoc.exists) {
                return res.status(404).send("Sala no encontrada");
            }
            // Guardar datos del invitado en Firestore
            yield roomRef.update({
                [`users.${guestId}`]: {
                    userName: guestName,
                    role: "guest"
                }
            });
            // Guardar datos del invitado en RTDB
            yield db.ref(`rooms/${generatedRoomId}/users/${guestId}`).set({
                userName: guestName,
                role: "guest"
            });
        }
        res.status(200).json({ roomId: generatedRoomId });
    }
    catch (error) {
        console.error("Error al guardar datos:", error);
        res.status(500).send("Error interno del servidor");
    }
}));
app.put("/api/rooms/:roomId/move", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roomId = req.params.roomId;
        const { playerNumber, move } = req.body;
        if (!roomId || !/^\d{4}$/.test(roomId)) {
            console.error(`roomId inválido: ${roomId}`);
            return res.status(400).json({ message: "roomId inválido. Debe ser un número de 4 dígitos." });
        }
        const gameRef = db.ref(`rooms/${roomId}/games/current`); // Referencia a la partida actual en RTDB
        const gameSnapshot = yield gameRef.get(); // Obtener los datos de la partida
        if (!gameSnapshot.exists()) {
            console.log(` Creando nodo games/current dentro de rooms/${roomId} porque no existe.`);
            yield gameRef.set({
                player1Move: null,
                player2Move: null,
                gameOver: false,
            });
        }
        if (gameSnapshot.exists()) {
            const gameData = gameSnapshot.val();
            let player1Move = gameData.player1Move;
            let player2Move = gameData.player2Move;
            if (playerNumber === 1) {
                player1Move = move;
                yield gameRef.update({ player1Move: move }); // Guarda la jugada en RTDB
            }
            else {
                player2Move = move;
                yield gameRef.update({ player2Move: move }); // Guarda la jugada en RTDB
            }
            if (player1Move && player2Move) {
                // Lógica del juego con datos de RTDB
                let result;
                if (player1Move === player2Move) {
                    result = "draw";
                }
                else if ((player1Move === "piedra" && player2Move === "tijera") ||
                    (player1Move === "papel" && player2Move === "piedra") ||
                    (player1Move === "tijera" && player2Move === "papel")) {
                    result = "player1Wins";
                }
                else {
                    result = "player2Wins";
                }
                // Actualización de estadísticas y estado del juego en RTDB
                yield gameRef.update({
                    result: result,
                    gameOver: true,
                    // Actualizar estadísticas aquí (si es necesario)
                });
                res.json({ message: "Movimiento registrado y juego actualizado", result });
                console.log(`Movimiento registrado en la sala ${roomId}, resultado: ${result}`);
            }
            else {
                res.json({ message: "Movimiento registrado" });
                console.log(`Movimiento registrado en la sala ${roomId}`);
            }
        }
        else {
            console.log(`Sala ${roomId} no encontrada.`);
            res.status(404).json({ message: "Sala no encontrada" });
        }
    }
    catch (error) {
        console.error("Error al registrar el movimiento:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
}));
// Iniciar el servidor
server.listen(port, () => {
    console.log(`Servidor iniciado en el puerto ${port}`);
});
//# sourceMappingURL=index.js.map