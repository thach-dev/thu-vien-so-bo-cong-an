const express = require("express");
const cors = require("cors");

const app = express();

// ========================
// CORS - CHO PHÉP TẤT CẢ
// ========================
app.use(cors());

// ========================
// JSON
// ========================
app.use(express.json());

// ========================
// AUTH ROUTES
// ========================
const authRoutes = require("./routes/auth");

app.use("/api/auth", authRoutes);

// ========================
// TEST SERVER
// ========================
app.get("/", (req, res) => {
  res.json({
    message: "Backend is running"
  });
});

// ========================
// EXPORT
// ========================
module.exports = app;