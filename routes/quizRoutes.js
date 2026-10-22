
const express = require("express");
const router = express.Router();

const quizController = require("../controllers/quizController");
const requireAuth = require("../middleware/requireAuth");

// Xác thực JWT trước khi tạo hoặc xem quiz
router.post("/", requireAuth, quizController.createQuiz);
router.get("/:id", requireAuth, quizController.getQuiz);

module.exports = router;
