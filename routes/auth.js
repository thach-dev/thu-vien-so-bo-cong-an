const express = require("express");

const router = express.Router();

const authController =
  require("../controllers/authController");

// ===============================
// DEBUG
// ===============================

console.log(
  "AUTH CONTROLLER:",
  authController
);

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
// AUTH ROUTES
// ===============================

router.post(
  "/register",
  authController.register
);

router.post(
  "/login",
  authController.login
);

router.post(
  "/qr-login",
  authController.qrLogin
);

module.exports = router;