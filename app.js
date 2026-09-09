const express = require("express");
const cors = require("cors");

const app = express();

// Cho phép tất cả origin
app.use(cors());

app.use(express.json());

const authRoutes = require("./routes/auth");

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Backend is running"
  });
});

app.use((req, res) => {
  res.status(404).json({
    message: "API không tồn tại",
    path: req.originalUrl
  });
});

module.exports = app;