const express = require("express");
const router = express.Router();
const multer = require("multer");

// Cấu hình multer nhận file vào RAM
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // Giới hạn 25MB
});

const documentController = require("../controllers/documentController");

// ===============================
// DEBUG
// ===============================
console.log("DOCUMENT CONTROLLER:", documentController);

// ===============================
// ROUTES
// ===============================

// Học viên tải lên tài liệu mới (file PDF + metadata)
router.post("/upload", upload.single("file"), documentController.uploadDocument);

// Lấy danh sách tài liệu đã duyệt (hiển thị trang chủ / kho tài liệu)
router.get("/approved", documentController.getApprovedDocuments);

// Lấy danh sách tài liệu chờ kiểm duyệt (dành cho Admin)
router.get("/pending", documentController.getPendingDocuments);

// Admin duyệt hoặc từ chối tài liệu
router.patch("/:id/status", documentController.updateDocumentStatus);

module.exports = router;