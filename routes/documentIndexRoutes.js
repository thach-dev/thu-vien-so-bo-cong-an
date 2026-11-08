
const express = require("express");

const router = express.Router();

const requireAuth = require("../middlewares/authMiddleware");

const {
    indexDocument,
} = require("../controllers/documentIndexController");

// Kiểm tra quyền ADMIN.
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Bạn không có quyền thực hiện chức năng này.",
        });
    }

    next();
};

// POST /api/document-index/:documentId
router.post(
    "/:documentId",
    requireAuth,
    requireAdmin,
    indexDocument
);

module.exports = router;
