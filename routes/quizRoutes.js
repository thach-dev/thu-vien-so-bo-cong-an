
const express = require("express");
const multer = require("multer");

const router = express.Router();
const quizController = require("../controllers/quizController");
const requireAuth = require("../middlewares/authMiddleware");

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    const path = require("path");
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

// Tạo Quiz thủ công hoặc từ tài liệu đã có trong Supabase.
router.post("/", requireAuth, quizController.createQuiz);

// Tạo Quiz từ file tải trực tiếp lên.
router.post(
  "/from-file",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (error) {
        return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
          message: error.message || "Không thể nhận file tải lên.",
        });
      }

      next();
    });
  },
  quizController.createQuizFromFile
);

// Đặt route /:id sau route cố định /from-file.
router.get("/:id", requireAuth, quizController.getQuiz);

module.exports = router;
