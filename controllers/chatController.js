
const {
    askGemini
} = require("../services/geminiService");

const {
    searchRelevantChunks
} = require("../services/documentIndexService");

// =====================================================
// CHAT VỚI TOÀN BỘ THƯ VIỆN TÀI LIỆU
// =====================================================

const chatWithDocument = async (req, res) => {
    try {
        const { question } = req.body;

        // 1. Kiểm tra câu hỏi
        if (!question || !String(question).trim()) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập câu hỏi."
            });
        }

        const userQuestion = String(question).trim();

        console.log("=================================");
        console.log("AI CHAT - TOÀN BỘ THƯ VIỆN");
        console.log("Question:", userQuestion);
        console.log("=================================");

        // 2. Tìm các đoạn văn bản liên quan trong chỉ mục
        const chunks = await searchRelevantChunks(
            userQuestion,
            15
        );

        if (!chunks || chunks.length === 0) {
            return res.status(404).json({
                success: false,
                message:
                    "Chưa tìm thấy nội dung phù hợp trong thư viện tài liệu. Vui lòng kiểm tra hệ thống lập chỉ mục."
            });
        }

        console.log(
            "Số đoạn tài liệu tìm được:",
            chunks.length
        );

        // 3. Tổng hợp nội dung từ nhiều tài liệu
        const documentContext = chunks.map((chunk, index) => {
            return `
NGUỒN ${index + 1}
Tên tài liệu: ${chunk.document_title}
Số trang: ${chunk.page_number ?? "Không xác định"}
Nội dung:
${chunk.content}
`;
        }).join("\n\n");

        // 4. Tạo danh sách nguồn tham khảo
        const sourcesMap = new Map();

        chunks.forEach((chunk) => {
            if (!sourcesMap.has(chunk.document_id)) {
                sourcesMap.set(chunk.document_id, {
                    documentId: chunk.document_id,
                    title: chunk.document_title,
                    pages: []
                });
            }

            const source = sourcesMap.get(chunk.document_id);

            if (
                chunk.page_number !== null &&
                chunk.page_number !== undefined &&
                !source.pages.includes(chunk.page_number)
            ) {
                source.pages.push(chunk.page_number);
            }
        });

        const sources = Array.from(sourcesMap.values());

        // 5. Gửi nội dung đã tìm kiếm cho Gemini
        const answer = await askGemini(
            userQuestion,
            documentContext,
            "Thư viện tài liệu đã được lập chỉ mục"
        );

        // 6. Trả kết quả
        return res.status(200).json({
            success: true,
            message: "AI đã tổng hợp tài liệu thành công.",
            answer,
            sources,
            totalChunks: chunks.length,
            totalDocuments: sources.length
        });

    } catch (error) {
        console.error("Chat controller error:", error);

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Không thể tổng hợp tài liệu."
        });
    }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    chatWithDocument
};
