const express = require("express");

const router = express.Router();

const {
  chatWithDocument
} = require("../controllers/chatController");

// ===============================
// CHAT WITH DOCUMENT
// ===============================

router.post(
  "/",
  chatWithDocument
);

module.exports = router;