
const quizService = require("../services/quizService");

async function createQuiz(req, res) {
  try {
    // req.user phải được middleware xác thực tạo ra.
    const ownerId = req.user?.id;

    if (!ownerId) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập",
      });
    }

    const quiz = await quizService.createQuiz(
      ownerId,
      req.body.title,
      req.body.questions
    );

    return res.status(201).json({
      message: "Tạo bộ câu hỏi thành công",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ ERROR:", error.message);

    return res.status(400).json({
      message: error.message || "Không thể tạo bộ câu hỏi",
    });
  }
}

async function getQuiz(req, res) {
  try {
    const quiz = await quizService.getQuizForHost(
      req.params.id,
      req.user?.id
    );

    return res.json({ quiz });
  } catch (error) {
    console.error("GET QUIZ ERROR:", error.message);

    return res.status(404).json({
      message: "Không tìm thấy bộ câu hỏi hoặc bạn không có quyền truy cập",
    });
  }
}

module.exports = { createQuiz, getQuiz };
