
const express = require("express");
const multer = require("multer");
const path = require("path");

const router = express.Router();

const quizController = require("../controllers/quizController");
const requireAuth = require("../middlewares/authMiddleware");

// ==========================================
// DEBUG: KIỂM TRA CÁC HANDLER
// ==========================================
console.log("QUIZ ROUTES DEBUG:", {
  requireAuth: typeof requireAuth,
  createQuiz: typeof quizController.createQuiz,
  createQuizFromFile: typeof quizController.createQuizFromFile,
  getMyQuizzes: typeof quizController.getMyQuizzes,
  getQuiz: typeof quizController.getQuiz,
});

// ==========================================
// CẤU HÌNH UPLOAD FILE
// ==========================================
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },

  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const allowedExtensions = [".pdf", ".docx", ".txt"];

    if (!allowedExtensions.includes(extension)) {
      return callback(
        new Error("Chỉ chấp nhận file PDF, DOCX hoặc TXT.")
      );
    }

    callback(null, true);
  },
});

// ==========================================
// POST /api/quizzes
// TẠO QUIZ
// ==========================================
router.post(
  "/",
  requireAuth,
  quizController.createQuiz
);

// ==========================================
// POST /api/quizzes/from-file
// TẠO QUIZ TỪ FILE
// ==========================================
router.post(
  "/from-file",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (error) {
        const statusCode =
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

        return res.status(statusCode).json({
          message:
            error.message || "Không thể nhận file tải lên.",
        });
      }

      next();
    });
  },
  quizController.createQuizFromFile
);

// ==========================================
// GET /api/quizzes
// LẤY DANH SÁCH QUIZ CỦA NGƯỜI DÙNG
// ==========================================
router.get(
  "/",
  requireAuth,
  quizController.getMyQuizzes
);

// ==========================================
// GET /api/quizzes/:id
// LẤY CHI TIẾT QUIZ
// ==========================================
router.get(
  "/:id",
  requireAuth,
  quizController.getQuiz
);

// ==========================================
// EXPORT ROUTER
// ==========================================
module.exports = router;