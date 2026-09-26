const express = require("express");
const router = express.Router();

const multer = require("multer");

const documentController =
  require("../controllers/documentController");

// =====================================================
// MULTER
// =====================================================

const storage =
  multer.memoryStorage();

const upload =
  multer({
    storage,

    limits: {
      fileSize:
        25 * 1024 * 1024
    }
  });

// =====================================================
// DEBUG
// =====================================================

console.log(
  "DOCUMENT CONTROLLER:",
  documentController
);

// =====================================================
// ROUTES
// =====================================================

// -----------------------------------------------------
// UPLOAD TÀI LIỆU
// -----------------------------------------------------

router.post(
  "/upload",
  upload.single("file"),
  documentController.uploadDocument
);

// -----------------------------------------------------
// LẤY TẤT CẢ TÀI LIỆU ĐÃ DUYỆT
// -----------------------------------------------------

router.get(
  "/approved",
  documentController.getApprovedDocuments
);

// -----------------------------------------------------
// SEARCH TÀI LIỆU
// -----------------------------------------------------

router.get(
  "/search",
  documentController.searchDocuments
);

// -----------------------------------------------------
// TÀI LIỆU CHỜ DUYỆT
// -----------------------------------------------------

router.get(
  "/pending",
  documentController.getPendingDocuments
);

// -----------------------------------------------------
// DUYỆT / TỪ CHỐI
// -----------------------------------------------------

router.patch(
  "/:id/status",
  documentController.updateDocumentStatus
);
// -----------------------------------------------------
// LOẠI SÁCH TÀI LIỆU
// -----------------------------------------------------

router.get(
  "/categories",
  documentController.getDocumentCategories
);
// =====================================================
// EXPORT
// =====================================================

module.exports = router;