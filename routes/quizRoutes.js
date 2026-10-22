
const express = require("express");
const router = express.Router();

const quizController = require("../controllers/quizController");

// TODO: Gắn middleware xác thực thực tế của dự án trước khi sử dụng.
router.post("/", quizController.createQuiz);
router.get("/:id", quizController.getQuiz);

module.exports = router;
