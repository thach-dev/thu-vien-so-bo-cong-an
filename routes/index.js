const express = require("express");
const router = express.Router();
const authRoutes = require("./auth");

// Gắn nhánh auth vào tiền tố /auth
router.use("/auth", authRoutes);

module.exports = router;