
const path = require("path");
const supabase = require("../supabase");
const quizService = require("../services/quizService");
const {
  generateQuizFromDocument,
} = require("../services/geminiService");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100000;

// ==========================================
// TRÍCH XUẤT VĂN BẢN TỪ FILE
// ==========================================
async function extractTextFromBuffer(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("File tải lên đang trống.");
  }

  const ext = path.extname(filename || "").toLowerCase();
  let text = "";

  if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buffer);
    text = result.text || "";
  } else if (ext === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (ext === ".txt") {
    text = buffer.toString("utf8");
  } else if (ext === ".doc") {
    throw new Error(
      "File DOC cũ chưa được hỗ trợ. Hãy chuyển sang DOCX."
    );
  } else {
    throw new Error("Chỉ hỗ trợ file PDF, DOCX hoặc TXT.");
  }

  text = text.replace(/\u0000/g, "").trim();

  if (!text) {
    throw new Error(
      "Không trích xuất được văn bản. PDF scan cần OCR."
    );
  }

  return text.slice(0, MAX_TEXT_LENGTH);
}

// ==========================================
// LẤY NỘI DUNG TÀI LIỆU ĐÃ ĐƯỢC DUYỆT
// ==========================================
async function getDocumentText(documentId) {
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, title, file_path, status")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Lỗi đọc tài liệu: ${error.message}`);
  }

  if (!document) {
    throw new Error("Không tìm thấy tài liệu.");
  }

  if (document.status !== "APPROVED") {
    throw new Error("Tài liệu chưa được phê duyệt.");
  }

  if (!document.file_path) {
    throw new Error("Tài liệu chưa có đường dẫn.");
  }

  const response = await fetch(document.file_path);

  if (!response.ok) {
    throw new Error(
      `Không tải được tài liệu: HTTP ${response.status}`
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

// ==========================================
// CHUẨN HÓA CÂU HỎI
// ==========================================
function normalizeQuestions(generatedQuiz) {
  const questions = Array.isArray(generatedQuiz)
    ? generatedQuiz
    : generatedQuiz?.questions;

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("AI không trả về danh sách câu hỏi.");
  }

  return questions.map((item, index) => {
    const questionText =
      item?.question_text ?? item?.question;

    const answers = item?.answers ?? item?.options;

    if (
      typeof questionText !== "string" ||
      !questionText.trim() ||
      !Array.isArray(answers) ||
      answers.length !== 4 ||
      answers.some(
        (answer) =>
          typeof answer !== "string" || !answer.trim()
      )
    ) {
      throw new Error(
        `Câu hỏi ${index + 1} không hợp lệ: cần nội dung và đúng 4 đáp án.`
      );
    }

    let correct =
      item.correct_answer ??
      item.correctAnswer ??
      item.correct_option;

    if (typeof correct === "string") {
      const value = correct.trim();

      if (/^[A-D]$/i.test(value)) {
        correct = value.toUpperCase().charCodeAt(0) - 65;
      } else {
        const answerIndex = answers.findIndex(
          (answer) =>
            typeof answer === "string" &&
            answer.trim() === value
        );

        if (answerIndex !== -1) {
          correct = answerIndex;
        } else if (/^[0-3]$/.test(value)) {
          correct = Number(value);
        } else if (/^[1-4]$/.test(value)) {
          correct = Number(value) - 1;
        }
      }
    }

    if (
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct > 3
    ) {
      throw new Error(
        `Đáp án đúng của câu ${index + 1} phải là chỉ số 0–3 hoặc A–D.`
      );
    }

    return {
      question_text: questionText.trim(),
      answers: answers.map((answer) => answer.trim()),
      correct_answer: correct,
      time_limit: Math.max(
        5,
        Math.min(
          120,
          Number(item.time_limit ?? item.timeLimit) || 20
        )
      ),
      points: Math.max(0, Number(item.points) || 1000),
    };
  });
}

// ==========================================
// TẠO QUIZ THỦ CÔNG HOẶC TỪ TÀI LIỆU
// ==========================================
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
          message: "Số câu hỏi phải nằm trong khoảng 1–50.",
        });
      }

      const document = await getDocumentText(documentId);

      const generated = await generateQuizFromDocument(
        document.text,
        document.title,
        count
      );

      quizQuestions = normalizeQuestions(generated);
      quizTitle = title || generated.title || document.title;
    }

    if (
      !Array.isArray(quizQuestions) ||
      quizQuestions.length === 0
    ) {
      return res.status(400).json({
        message: "Không có câu hỏi hợp lệ để lưu.",
      });
    }

    if (quizQuestions.length > 50) {
      return res.status(400).json({
        message: "Một bộ Quiz không được vượt quá 50 câu.",
      });
    }

    if (
      typeof quizTitle !== "string" ||
      !quizTitle.trim()
    ) {
      quizTitle = "Bộ câu hỏi mới";
    }

    const quiz = await quizService.createQuiz(
      ownerId,
      quizTitle.trim(),
      quizQuestions
    );

    return res.status(201).json({
      message: "Tạo Quiz thành công.",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ ERROR:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Không thể tạo Quiz.",
    });
  }
}

// ==========================================
// TẠO QUIZ TỪ FILE UPLOAD
// ==========================================
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
        message: "Vui lòng chọn file để tải lên.",
      });
    }

    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(413).json({
        message: "File tối đa 10 MB.",
      });
    }

    const count = Number(req.body?.questionCount ?? 10);

    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return res.status(400).json({
        message: "Số câu hỏi phải nằm trong khoảng 1–50.",
      });
    }

    const text = await extractTextFromBuffer(
      req.file.buffer,
      req.file.originalname
    );

    const title =
      typeof req.body?.title === "string" &&
      req.body.title.trim()
        ? req.body.title.trim()
        : path.basename(
            req.file.originalname,
            path.extname(req.file.originalname)
          ) || "Quiz từ tài liệu";

    const generated = await generateQuizFromDocument(
      text,
      title,
      count
    );

    const questions = normalizeQuestions(generated);

    const quiz = await quizService.createQuiz(
      ownerId,
      title,
      questions
    );

    return res.status(201).json({
      message: "Đã tạo và lưu Quiz thành công.",
      quiz,
    });
  } catch (error) {
    console.error("CREATE QUIZ FROM FILE ERROR:", {
      message: error.message,
      stack: error.stack,
    });

    return res.status(error.status || 500).json({
      message:
        error.message || "Không thể tạo Quiz từ file.",
    });
  }
}

// ==========================================
// LẤY CHI TIẾT QUIZ
// ==========================================
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

    return res.status(200).json({ quiz });
  } catch (error) {
    console.error("GET QUIZ ERROR:", error.message);

    return res.status(404).json({
      message:
        "Không tìm thấy Quiz hoặc bạn không có quyền truy cập.",
    });
  }
}

// ==========================================
// LẤY DANH SÁCH QUIZ CỦA TÀI KHOẢN
// ==========================================
async function getMyQuizzes(req, res) {
  try {
    const ownerId = req.user?.id;

    if (!ownerId) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập.",
      });
    }

    if (
      typeof quizService.getQuizzesForUser !== "function"
    ) {
      console.error(
        "quizService.getQuizzesForUser chưa được khai báo hoặc export."
      );

      return res.status(500).json({
        message:
          "Backend chưa cấu hình chức năng lấy danh sách Quiz.",
      });
    }

    const quizzes = await quizService.getQuizzesForUser(ownerId);

    return res.status(200).json({
      success: true,
      quizzes,
    });
  } catch (error) {
    console.error("GET MY QUIZZES ERROR:", error);

    return res.status(500).json({
      message:
        error.message || "Không thể lấy danh sách Quiz.",
    });
  }
}

// ==========================================
// EXPORT CONTROLLER
// ==========================================
module.exports = {
  createQuiz,
  createQuizFromFile,
  getQuiz,
  getMyQuizzes,
  getDocumentText,
  extractTextFromBuffer,
};