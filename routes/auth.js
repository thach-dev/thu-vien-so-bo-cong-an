const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");

// ===============================
// DEBUG
// ===============================

console.log("AUTH CONTROLLER:", authController);

console.log(
  "REGISTER TYPE:",
  typeof authController.register
);

console.log(
  "LOGIN TYPE:",
  typeof authController.login
);

console.log(
  "QR LOGIN TYPE:",
  typeof authController.qrLogin
);

// ===============================
// ROUTES
// ===============================

// Đăng ký
router.post(
  "/register",
  authController.register
);

// Đăng nhập bằng username + password
router.post(
  "/login",
  authController.login
);

// Đăng nhập bằng mã QR
router.post(
  "/qr-login",
  authController.qrLogin
);

module.exports = router;