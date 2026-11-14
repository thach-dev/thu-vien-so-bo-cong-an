
const express = require("express");
const multer = require("multer");
const path = require("path");

const requireAdmin = require("../middlewares/adminMiddleware");

const {
    uploadWordSet,
    getWordSets,
    getWordSetDetail,
    removeWordSet,
} = require("../controllers/wordChainController");

const router = express.Router();

// =====================================================
// MULTER
// =====================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 5 * 1024 * 1024,
    },

    fileFilter: (req, file, cb) => {
        const ext = path.extname(
            file.originalname
        ).toLowerCase();

        if (![".xlsx", ".xls"].includes(ext)) {
            return cb(
                new Error(
                    "Chỉ chấp nhận file Excel .xlsx hoặc .xls."
                )
            );
        }

        cb(null, true);
    },
});

// =====================================================
// API
// =====================================================

// Danh sách bộ ghép nối đã duyệt
router.get("/sets", getWordSets);

// Chi tiết bộ ghép nối
router.get("/sets/:id", getWordSetDetail);

// Upload Excel
router.post(
    "/upload",
    (req, res, next) => {
        upload.single("file")(req, res, (error) => {
            if (!error) return next();

            return res.status(400).json({
                success: false,
                message: error.message || "Lỗi upload file.",
            });
        });
    },
    uploadWordSet
);

// Xóa bộ dữ liệu: chỉ ADMIN
router.delete(
    "/sets/:id",
    requireAdmin,
    removeWordSet
);

module.exports = router;
