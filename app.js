const express = require("express");
const cors = require("cors");

const app = express();

// Cho phép tất cả domain
app.use(cors());

app.use(express.json());

const authRoutes = require("./routes/auth");

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Backend is running"
  });
});

module.exports = app;