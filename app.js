
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

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/quizzes", require("./routes/quizRoutes"));

// =====================================================
// ROUTE GAME KAHOOT
// =====================================================
const quizRoutes = require("./routes/quizRoutes");

app.use("/api/quizzes", quizRoutes);

// =====================================================
// ROOT
// =====================================================
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Backend is running",
    game: "Kahoot API ready",
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

// Đăng ký sự kiện game
const registerQuizSocket = require("./sockets/quizSocket");
registerQuizSocket(io);

// =====================================================
// EXPORT
// =====================================================
module.exports = app;
module.exports.server = server;
module.exports.io = io;
