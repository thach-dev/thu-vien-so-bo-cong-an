const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");

// Tuyệt đối KHÔNG viết "/api/auth/register", chỉ viết "/register"
router.post("/register", register);
router.post("/login", login);

module.exports = router;