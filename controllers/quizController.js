
const supabase = require("../supabase");
const quizService = require("../services/quizService");
const {
  generateQuizFromDocument,
} = require("../services/geminiService");

// =====================================================
// LẤY VÀ TRÍCH XUẤT NỘI DUNG TÀI LIỆU
// Hỗ trợ PDF, DOCX, TXT
// =====================================================
async function getDocumentText(documentId) {
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, title, description, file_path, status")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Không thể lấy tài liệu: ${error.message}`);
  }

  if (!document) {
    throw new Error("Không tìm thấy tài liệu.");
  }

  if (document.status !== "APPROVED") {
    throw new Error("Tài liệu chưa được phê duyệt.");
  }

  if (!document.file_path) {
    throw new Error("Tài liệu chưa có đường dẫn tải xuống.");
  }

  const response = await fetch(document.file_path);

  if (!response.ok) {
    throw new Error(
      `Không tải được tài liệu từ Storage (HTTP ${response.status}).`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const cleanUrl = document.file_path.split("?")[0].toLowerCase();
  const extension = cleanUrl.substring(cleanUrl.lastIndexOf("."));

  let text = "";

  if (extension === ".pdf") {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(buffer);
    text = parsed.text || "";
  } else if (extension === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (extension === ".txt") {
    text = buffer.toString("utf8");
  } else if (extension === ".doc") {
    throw new Error(
      "File DOC định dạng cũ chưa được hỗ trợ trực tiếp. " +
      "Vui lòng chuyển file sang DOCX rồi tải lên lại."
    );
  } else {
    throw new Error(
      `Định dạng ${extension || "không xác định"} chưa được hỗ trợ. ` +
      "Vui lòng sử dụng PDF, DOCX hoặc TXT."
    );
  }

  text = text.trim();

  if (!text) {
    throw new Error(
      "Không trích xuất được văn bản. Nếu PDF là bản scan, cần xử lý OCR."
    );
  }

  return {
    id: document.id,
    title: document.title || "Tài liệu",
    text,
  };
}

// =====================================================
// POST /api/quizzes
// TẠO QUIZ THỦ CÔNG HOẶC BẰNG AI
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
    } = req.body || {};

    let quizTitle = title;
    let quizQuestions = questions;

    // Tạo câu hỏi từ tài liệu bằng AI
    if (documentId) {
      const count = Number(questionCount);

      if (!Number.isInteger(count) || count < 1 || count > 50) {
        return res.status(400).json({
          message: "Số câu hỏi phải nằm trong khoảng 1 đến 50.",
        });
      }

      const document = await getDocumentText(documentId);

      const generatedQuiz = await generateQuizFromDocument(
        document.text,
        document.title,
        count
      );

      if (
        !generatedQuiz ||
        !Array.isArray(generatedQuiz.questions) ||
        generatedQuiz.questions.length === 0
      ) {
        throw new Error("AI không tạo được danh sách câu hỏi hợp lệ.");
      }

      quizTitle = title || generatedQuiz.title || document.title;

      quizQuestions = generatedQuiz.questions.map((item, index) => {
        if (
          !item.question ||
          !Array.isArray(item.answers) ||
          item.answers.length < 2
        ) {
          throw new Error(
            `Câu hỏi số ${index + 1} do AI tạo không hợp lệ.`
          );
        }

        return {
          question: item.question,
          answers: item.answers,
          correctAnswer: item.correctAnswer,
          explanation: item.explanation || "",
          timeLimit: 20,
          points: 1000,
        };
      });
    }

    // Kiểm tra câu hỏi đầu vào
    if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
      return res.status(400).json({
        message:
          "Không có câu hỏi. Hãy chọn tài liệu để AI tạo câu hỏi " +
          "hoặc gửi danh sách câu hỏi thủ công.",
      });
    }

    if (!quizTitle || typeof quizTitle !== "string") {
      quizTitle = "Bộ câu hỏi mới";
    }

    // Lưu bằng service hiện tại
    const quiz = await quizService.createQuiz(
      ownerId,
      quizTitle.trim(),
      quizQuestions
    );

    return res.status(201).json({
      message: documentId
        ? "AI tạo và lưu bộ câu hỏi thành công."
        : "Tạo bộ câu hỏi thành công.",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ ERROR:", error);

    return res.status(500).json({
      message: error.message || "Không thể tạo bộ câu hỏi.",
    });
  }
}

// =====================================================
// GET /api/quizzes/:id
// LẤY QUIZ CHO NGƯỜI TẠO
// =====================================================
async function getQuiz(req, res) {
  try {
    const ownerId = req.user?.id;

    if (!ownerId) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập",
      });
    }

    const quiz = await quizService.getQuizForHost(
      req.params.id,
      ownerId
    );

    if (!quiz) {
      return res.status(404).json({
        message: "Không tìm thấy bộ câu hỏi.",
      });
    }

    return res.status(200).json({ quiz });
  } catch (error) {
    console.error("GET QUIZ ERROR:", error);

    return res.status(404).json({
      message:
        "Không tìm thấy bộ câu hỏi hoặc bạn không có quyền truy cập.",
    });
  }
}

module.exports = {
  createQuiz,
  getQuiz,
};
