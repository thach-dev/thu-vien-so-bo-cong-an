
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// =====================================================
// CORS
// =====================================================
app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// =====================================================
// BODY PARSER
// =====================================================
app.use(express.json());

// =====================================================
// ROUTES CŨ
// =====================================================
const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/document");
const chatRoutes = require("./routes/chatRoutes");
const documentIndexRoutes = require("./routes/documentIndexRoutes");
const wordChainRoutes = require("./routes/wordChainRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/document-index", documentIndexRoutes);

// =====================================================
// ROUTE GAME KAHOOT
// =====================================================
const quizRoutes = require("./routes/quizRoutes");

app.use("/api/quizzes", quizRoutes);

// =====================================================
// GOOGLE SCRIPTS
// =====================================================
app.use(
    "/api/google",
    require("./routes/googleScriptRoutes")
);

// =====================================================
// ROUTE GAME GHÉP ĐÔI
// =====================================================
app.use("/api/word-chain", wordChainRoutes);

// =====================================================
// ROOT
// =====================================================
app.get("/", (req, res) => {
    res.status(200).json({
        message: "Backend is running",
        game: "Kahoot API ready",
        matchingGame: "Word Matching Game ready",
        googleScript: "Google Script API ready",
    });
});

// =====================================================
// 404
// =====================================================
app.use((req, res) => {
    res.status(404).json({
        message: "API không tồn tại",
        path: req.originalUrl,
    });
});

// =====================================================
// HTTP SERVER + SOCKET.IO
// =====================================================
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

// =====================================================
// SOCKET GAME KAHOOT
// GIỮ NGUYÊN HOÀN TOÀN
// =====================================================
const registerQuizSocket = require("./sockets/quizSocket");

registerQuizSocket(io);

// =====================================================
// SOCKET GAME GHÉP ĐÔI
// HỆ THỐNG RIÊNG, KHÔNG ẢNH HƯỞNG KAHOOT
// =====================================================
const registerWordChainSocket = require("./sockets/wordChainSocket");

registerWordChainSocket(io);

// =====================================================
// EXPORT
// =====================================================
module.exports = app;
module.exports.server = server;
module.exports.io = io;
