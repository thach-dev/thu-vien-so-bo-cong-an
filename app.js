const express = require("express");

const app = express();

app.use(express.json());

// routes của bạn
// app.use("/api/...", ...);

app.get("/", (req, res) => {
    res.json({
        message: "Backend is running"
    });
});

module.exports = app;