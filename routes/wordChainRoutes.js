
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
        const ext = path.extname(file.originalname).toLowerCase();

        if (![".xlsx", ".xls"].includes(ext)) {
            return cb(
                new Error("Chỉ chấp nhận file Excel .xlsx hoặc .xls.")
            );
        }

        cb(null, true);
    },
});

// =====================================================
// API
// =====================================================

// Danh sách bộ từ đã duyệt
router.get("/sets", getWordSets);

// Chi tiết bộ từ
router.get("/sets/:id", getWordSetDetail);

// Upload Excel công khai
router.post(
    "/upload",
    upload.single("file"),
    uploadWordSet
);

// Xóa bộ từ: chỉ ADMIN
router.delete(
    "/sets/:id",
    requireAdmin,
    removeWordSet
);

module.exports = router;
