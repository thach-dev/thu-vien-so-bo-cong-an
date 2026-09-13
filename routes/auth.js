const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");


// Debug
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


// Routes
router.post(
  "/register",
  authController.register
);

router.post(
  "/login",
  authController.login
);


module.exports = router;