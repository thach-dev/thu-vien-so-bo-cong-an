const express = require("express");
const multer = require("multer");
const path = require("path");

const router = express.Router();

const quizController = require("../controllers/quizController");
const requireAuth = require("../middlewares/authMiddleware");

console.log("QUIZ ROUTES DEBUG:", {
  requireAuth: typeof requireAuth,
  createQuiz: typeof quizController.createQuiz,
  createQuizFromFile: typeof quizController.createQuizFromFile,
  uploadExcelQuiz: typeof quizController.uploadExcelQuiz,
  getMyQuizzes: typeof quizController.getMyQuizzes,
  getQuiz: typeof quizController.getQuiz,
});

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = [".pdf", ".docx", ".txt"];

    if (!allowedExtensions.includes(extension)) {
      return callback(new Error("Chỉ chấp nhận file PDF, DOCX hoặc TXT."));
    }

    callback(null, true);
  },
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = [".xlsx", ".xls"];

    if (!allowedExtensions.includes(extension)) {
      return callback(new Error("Chỉ chấp nhận file Excel .xlsx hoặc .xls."));
    }

    callback(null, true);
  },
});

function handleUpload(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware.single("file")(req, res, (error) => {
      if (error) {
        const statusCode =
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

        return res.status(statusCode).json({
          message: error.message || "Không thể nhận file tải lên.",
        });
      }

      next();
    });
  };
}

// POST /api/quizzes
router.post("/", requireAuth, quizController.createQuiz);

// POST /api/quizzes/from-file
router.post(
  "/from-file",
  requireAuth,
  handleUpload(documentUpload),
  quizController.createQuizFromFile
);

// POST /api/quizzes/upload-excel
router.post(
  "/upload-excel",
  requireAuth,
  handleUpload(excelUpload),
  quizController.uploadExcelQuiz
);

// GET /api/quizzes
router.get("/", requireAuth, quizController.getMyQuizzes);

// GET /api/quizzes/:id
router.get("/:id", requireAuth, quizController.getQuiz);

module.exports = router;