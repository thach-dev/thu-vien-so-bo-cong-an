
const supabase = require("../supabase");
const quizService = require("../services/quizService");
const {
  generateQuizFromDocument,
} = require("../services/geminiService");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_LENGTH = 100000;

// =====================================================
// TRÍCH XUẤT NỘI DUNG TỪ BUFFER
// Hỗ trợ PDF, DOCX, TXT
// =====================================================
async function extractTextFromBuffer(buffer, filename) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("File tải lên đang trống.");
  }

  const extension = require("path")
    .extname(filename || "")
    .toLowerCase();

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
      "Không hỗ trợ DOC định dạng cũ. " +
      "Vui lòng chuyển sang DOCX."
    );
  } else {
    throw new Error(
      "Định dạng file không được hỗ trợ. " +
      "Vui lòng tải PDF, DOCX hoặc TXT."
    );
  }

  text = text
    .replace(/\u0000/g, "")
    .trim();

  if (!text) {
    throw new Error(
      "Không đọc được nội dung tài liệu. " +
      "Nếu PDF là bản scan, cần OCR trước."
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH);
  }

  return text;
}

// =====================================================
// LẤY NỘI DUNG TÀI LIỆU ĐÃ DUYỆT TỪ SUPABASE
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

  const text = await extractTextFromBuffer(
    buffer,
    document.file_path.split("?")[0]
  );

  return {
    id: document.id,
    title: document.title || "Tài liệu",
    text,
  };
}

// =====================================================
// CHUẨN HÓA CÂU HỎI AI
// =====================================================
function normalizeQuestions(generatedQuiz) {
  if (
    !generatedQuiz ||
    !Array.isArray(generatedQuiz.questions) ||
    generatedQuiz.questions.length === 0
  ) {
    throw new Error("AI không tạo được danh sách câu hỏi hợp lệ.");
  }

  return generatedQuiz.questions.map((item, index) => {
    if (
      !item.question ||
      !Array.isArray(item.answers) ||
      item.answers.length < 2
    ) {
      throw new Error(
        `Câu hỏi số ${index + 1} do AI tạo không hợp lệ.`
      );
    }

    // Hỗ trợ correctAnswer là index hoặc nội dung đáp án.
    let correctAnswer = item.correctAnswer;

    if (typeof correctAnswer === "string") {
      const answerIndex = item.answers.findIndex(
        (answer) => answer === correctAnswer
      );

      if (answerIndex !== -1) {
        correctAnswer = answerIndex;
      } else if (/^\d+$/.test(correctAnswer)) {
        correctAnswer = Number(correctAnswer);
      }
    }

    if (
      !Number.isInteger(correctAnswer) ||
      correctAnswer < 0 ||
      correctAnswer >= item.answers.length
    ) {
      throw new Error(
        `Đáp án đúng của câu ${index + 1} không hợp lệ.`
      );
    }

    return {
      question: String(item.question).trim(),
      answers: item.answers.map((answer) => String(answer)),
      correctAnswer,
      explanation: item.explanation || "",
      timeLimit: 20,
      points: 1000,
    };
  });
}

// =====================================================
// POST /api/quizzes
// TẠO QUIZ THỦ CÔNG HOẶC TỪ TÀI LIỆU SUPABASE
// =====================================================
async function createQuiz(req, res) {
  try {
    const ownerId = req.user?.id;

    if (!ownerId) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập.",
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

      quizQuestions = normalizeQuestions(generatedQuiz);
      quizTitle = title || generatedQuiz.title || document.title;
    }

    if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
      return res.status(400).json({
        message:
          "Không có câu hỏi. Hãy chọn tài liệu hoặc gửi danh sách câu hỏi.",
      });
    }

    if (quizQuestions.length > 50) {
      return res.status(400).json({
        message: "Một Quiz không được vượt quá 50 câu hỏi.",
      });
    }

    if (typeof quizTitle !== "string" || !quizTitle.trim()) {
      quizTitle = "Bộ câu hỏi mới";
    }

    const quiz = await quizService.createQuiz(
      ownerId,
      quizTitle.trim(),
      quizQuestions
    );

    return res.status(201).json({
      message: documentId
        ? "AI đã tạo và lưu Quiz từ tài liệu thành công."
        : "Tạo Quiz thành công.",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ ERROR:", error);

    return res.status(500).json({
      message: error.message || "Không thể tạo Quiz.",
      error: error.message || "Không có thông tin lỗi.",
      status: error.status || error.response?.status || null,
    });
  }
}

// =====================================================
// POST /api/quizzes/from-file
// TẠO QUIZ TỪ FILE UPLOAD TRỰC TIẾP
// Yêu cầu multer đặt req.file
// =====================================================
async function createQuizFromFile(req, res) {
  try {
    const ownerId = req.user?.id;

    if (!ownerId) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Ông chưa chọn file để tải lên.",
      });
    }

    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(413).json({
        message: "File tối đa 10 MB.",
      });
    }

    const {
      title,
      questionCount = 10,
    } = req.body || {};

    const count = Number(questionCount);

    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return res.status(400).json({
        message: "Số câu hỏi phải nằm trong khoảng 1 đến 50.",
      });
    }

    // Đọc nội dung file trong bộ nhớ, không lưu file tạm lên server.
    const documentText = await extractTextFromBuffer(
      req.file.buffer,
      req.file.originalname
    );

    const filenameWithoutExtension = require("path")
      .basename(req.file.originalname, require("path").extname(req.file.originalname));

    const documentTitle =
      typeof title === "string" && title.trim()
        ? title.trim()
        : filenameWithoutExtension || "Quiz từ tài liệu tải lên";

    // Gọi Gemini tạo câu hỏi từ nội dung file.
    const generatedQuiz = await generateQuizFromDocument(
      documentText,
      documentTitle,
      count
    );

    const quizQuestions = normalizeQuestions(generatedQuiz);

    // Lưu Quiz bằng service hiện tại.
    const quiz = await quizService.createQuiz(
      ownerId,
      documentTitle || generatedQuiz.title || "Quiz mới",
      quizQuestions
    );

    return res.status(201).json({
      message: "Đã đọc file, tạo câu hỏi và lưu Quiz thành công.",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ FROM FILE ERROR:", error);

    return res.status(500).json({
      message: error.message || "Không thể tạo Quiz từ file.",
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
        message: "Vui lòng đăng nhập.",
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
  createQuizFromFile,
  getQuiz,
  getDocumentText,
  extractTextFromBuffer,
};
