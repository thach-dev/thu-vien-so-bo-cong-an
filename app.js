const express = require("express");

const app = express();


// Middleware
app.use(express.json());


// Routes
const authRoutes = require("./routes/auth");

app.use("/api/auth", authRoutes);


// Test server
app.get("/", (req, res) => {
  res.json({
    message: "Backend is running"
  });
});


module.exports = app;