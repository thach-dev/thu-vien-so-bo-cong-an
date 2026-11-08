
const {
    indexApprovedDocument,
} = require("../services/documentIndexService");

// POST /api/document-index/:documentId
const indexDocument = async (req, res) => {
    try {
        const { documentId } = req.params;

        // 1. Kiểm tra ID
        if (!documentId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID tài liệu.",
            });
        }

        // 2. Kiểm tra quyền ADMIN
        if (!req.user || req.user.role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Bạn không có quyền lập chỉ mục tài liệu.",
            });
        }

        console.log("ADMIN INDEX DOCUMENT:", {
            adminId: req.user.id,
            documentId,
        });

        // 3. Lập chỉ mục và lưu vào document_contents
        const result = await indexApprovedDocument(documentId);

        // 4. Trường hợp không lập chỉ mục
        if (result?.skipped) {
            return res.status(200).json({
                success: false,
                skipped: true,
                message: result.reason || "Tài liệu không được lập chỉ mục.",
                result,
            });
        }

        // 5. Trả kết quả
        return res.status(200).json({
            success: true,
            message: "Lập chỉ mục tài liệu thành công.",
            storage: "document_contents",
            totalChunks: result.totalChunks || 0,
            result,
        });

    } catch (error) {
        console.error("INDEX DOCUMENT ERROR:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể lập chỉ mục tài liệu.",
        });
    }
};

module.exports = {
    indexDocument,
};
