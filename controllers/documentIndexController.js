
const {
    indexApprovedDocument,
} = require("../services/documentIndexService");

// POST /api/document-index/:documentId
const indexDocument = async (req, res) => {
    try {
        const { documentId } = req.params;

        if (!documentId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID tài liệu.",
            });
        }

        console.log("ADMIN INDEX DOCUMENT:", {
            adminId: req.user.id,
            documentId,
        });

        const result = await indexApprovedDocument(documentId);

        if (result.skipped) {
            return res.status(200).json({
                success: false,
                message: result.reason,
                result,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Lập chỉ mục tài liệu thành công.",
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
