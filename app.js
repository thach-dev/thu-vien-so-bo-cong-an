const express = require("express");
const cors = require("cors");

const app = express();

// ========================
// CORS
// Cho phép tất cả origin
// ========================
app.use(cors());

// ========================
// JSON BODY
// ========================
app.use(express.json());

// ========================
// AUTH ROUTES
// ========================
const authRoutes = require("./routes/auth");

app.use("/api/auth", authRoutes);

// ========================
// TEST BACKEND
// ========================
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Backend is running"
  });
});

// ========================
// 404
// ========================
app.use((req, res) => {
  res.status(404).json({
    message: "API không tồn tại",
    path: req.originalUrl
  });
});

// ========================
// EXPORT
// ========================
module.exports = app;