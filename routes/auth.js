const express = require("express");

const router = express.Router();

const {
  register,
  login
} = require("../controllers/authController");

// ========================
// REGISTER
// POST /api/auth/register
// ========================
router.post("/register", register);

// ========================
// LOGIN
// POST /api/auth/login
// ========================
router.post("/login", login);

module.exports = router;