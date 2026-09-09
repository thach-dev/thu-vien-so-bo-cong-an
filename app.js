const express = require("express");

const app = express();

app.use(express.json());

const authRoutes = require("./routes/auth");

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Backend is running"
  });
});

module.exports = app;