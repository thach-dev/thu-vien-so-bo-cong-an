
const quizService = require("../services/quizService");

const {
  generateQuizFromDocument,
} = require("../services/geminiService");

// =====================================================
// TẠO QUIZ BẰNG AI
// POST /api/quizzes
// =====================================================

async function createQuiz(req, res) {
  try {
    const ownerId = req.user?.id;

    if (!ownerId) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập",
      });
    }

    const {
      title,
      questions,
      documentId,
      questionCount = 10,
    } = req.body;

    let quizTitle = title;
    let quizQuestions = questions;

    // Nếu frontend gửi documentId,
    // hệ thống sẽ tạo câu hỏi bằng AI.
    if (documentId) {
      const documentService = require("../services/documentService");

      // Hàm này cần được triển khai trong documentService
      // để lấy văn bản thực tế từ PDF/tài liệu.
      const document = await documentService.getDocumentText(
        documentId
      );

      if (!document || !document.text) {
        return res.status(400).json({
          message: "Không đọc được nội dung tài liệu.",
        });
      }

      const generatedQuiz = await generateQuizFromDocument(
        document.text,
        document.title,
        questionCount
      );

      quizTitle = title || generatedQuiz.title;
      quizQuestions = generatedQuiz.questions.map((item) => ({
        question: item.question,
        answers: item.answers,
        correctAnswer: item.correctAnswer,
        explanation: item.explanation,
        timeLimit: 20,
        points: 1000,
      }));
    }

    // Vẫn cho phép tạo Quiz bằng câu hỏi nhập thủ công.
    if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
      return res.status(400).json({
        message:
          "Không có câu hỏi. Hãy chọn tài liệu để AI tạo câu hỏi hoặc nhập câu hỏi thủ công.",
      });
    }

    // Lưu bằng service hiện tại của dự án
    const quiz = await quizService.createQuiz(
      ownerId,
      quizTitle,
      quizQuestions
    );

    return res.status(201).json({
      message: documentId
        ? "AI tạo và lưu bộ câu hỏi thành công"
        : "Tạo bộ câu hỏi thành công",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ ERROR:", error);

    return res.status(500).json({
      message: error.message || "Không thể tạo bộ câu hỏi",
    });
  }
}

// =====================================================
// LẤY QUIZ
// GET /api/quizzes/:id
// =====================================================

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
      message:
        "Không tìm thấy bộ câu hỏi hoặc bạn không có quyền truy cập",
    });
  }
}

module.exports = {
  createQuiz,
  getQuiz,
};
