const express = require("express");

const router = express.Router();

const { register, login } = require("../controllers/authController");

console.log("REGISTER TYPE:", typeof register);
console.log("LOGIN TYPE:", typeof login);

router.post("/register", register);
router.post("/login", login);

module.exports = router;