
const {
    askGemini,
} = require("../services/geminiService");

const {
    searchRelevantChunks,
} = require("../services/documentIndexService");

// =====================================================
// CẤU HÌNH
// =====================================================

const MAX_CONTEXT_CHUNKS = 15;

const MAX_CONTEXT_LENGTH = 25000;

// =====================================================
// 1. TẠO NGỮ CẢNH TỪ CÁC CHUNK
// =====================================================

const buildDocumentContext = (chunks) => {
    const contextParts = [];

    const usedChunks = [];

    let currentLength = 0;

    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];

        const part = `
NGUỒN ${index + 1}
Tên tài liệu: ${chunk.document_title || "Không xác định"}
ID tài liệu: ${chunk.document_id}
Số trang: ${chunk.page_number ?? "Không xác định"}
Đoạn: ${chunk.chunk_index ?? index}
Độ liên quan: ${
            typeof chunk.similarity === "number"
                ? (chunk.similarity * 100).toFixed(2) + "%"
                : "Không xác định"
        }

NỘI DUNG:
${chunk.content}
`;

        // Không vượt giới hạn context.
        if (
            currentLength + part.length >
            MAX_CONTEXT_LENGTH
        ) {
            break;
        }

        contextParts.push(part);

        usedChunks.push(chunk);

        currentLength += part.length;
    }

    return {
        context: contextParts.join("\n\n"),

        usedChunks,

        contextLength: currentLength,
    };
};

// =====================================================
// 2. TẠO DANH SÁCH NGUỒN THAM KHẢO
// =====================================================

const buildSources = (chunks) => {
    const sourcesMap = new Map();

    for (const chunk of chunks) {
        const documentId = chunk.document_id;

        if (!documentId) {
            continue;
        }

        if (!sourcesMap.has(documentId)) {
            sourcesMap.set(documentId, {
                documentId,

                title:
                    chunk.document_title ||
                    "Tài liệu không xác định",

                pages: [],

                chunks: [],

                matchedChunks: 0,
            });
        }

        const source = sourcesMap.get(documentId);

        source.matchedChunks++;

        // Lưu số trang.
        if (
            chunk.page_number !== null &&
            chunk.page_number !== undefined
        ) {
            const pageNumber = Number(
                chunk.page_number
            );

            if (
                Number.isFinite(pageNumber) &&
                !source.pages.includes(pageNumber)
            ) {
                source.pages.push(pageNumber);
            }
        }

        // Lưu chỉ số đoạn.
        if (
            chunk.chunk_index !== null &&
            chunk.chunk_index !== undefined
        ) {
            if (
                !source.chunks.includes(
                    chunk.chunk_index
                )
            ) {
                source.chunks.push(
                    chunk.chunk_index
                );
            }
        }
    }

    const sources = Array.from(
        sourcesMap.values()
    );

    // Sắp xếp trang và chunk.
    for (const source of sources) {
        source.pages.sort(
            (a, b) => a - b
        );

        source.chunks.sort(
            (a, b) => a - b
        );
    }

    return sources;
};

// =====================================================
// 3. CHAT VỚI TOÀN BỘ THƯ VIỆN TÀI LIỆU
// =====================================================

const chatWithDocument = async (req, res) => {
    try {
        const { question } = req.body || {};

        // ---------------------------------------------
        // BƯỚC 1: KIỂM TRA CÂU HỎI
        // ---------------------------------------------

        if (
            !question ||
            !String(question).trim()
        ) {
            return res.status(400).json({
                success: false,

                message: "Vui lòng nhập câu hỏi.",
            });
        }

        const userQuestion = String(
            question
        ).trim();

        console.log("=================================");
        console.log("AI CHAT - JSON DOCUMENT LIBRARY");
        console.log("Question:", userQuestion);
        console.log("=================================");

        // ---------------------------------------------
        // BƯỚC 2: TÌM KIẾM TRONG DOCUMENT_CONTENTS
        // ---------------------------------------------

        const chunks = await searchRelevantChunks(
            userQuestion,
            MAX_CONTEXT_CHUNKS
        );

        if (
            !Array.isArray(chunks) ||
            chunks.length === 0
        ) {
            return res.status(404).json({
                success: false,

                code: "DOCUMENT_CONTENT_NOT_FOUND",

                message:
                    "Chưa tìm thấy nội dung phù hợp trong thư viện. Vui lòng kiểm tra tài liệu đã được lập chỉ mục vào document_contents hay chưa.",
            });
        }

        console.log(
            "Số đoạn JSON tìm được:",
            chunks.length
        );

        // ---------------------------------------------
        // BƯỚC 3: TẠO CONTEXT
        // ---------------------------------------------

        const {
            context: documentContext,
            usedChunks,
            contextLength,
        } = buildDocumentContext(chunks);

        if (!documentContext.trim()) {
            return res.status(404).json({
                success: false,

                code: "EMPTY_DOCUMENT_CONTEXT",

                message:
                    "Không có nội dung hợp lệ để gửi cho AI.",
            });
        }

        console.log(
            "Số đoạn thực sự gửi Gemini:",
            usedChunks.length
        );

        console.log(
            "Độ dài nội dung gửi Gemini:",
            contextLength
        );

        // ---------------------------------------------
        // BƯỚC 4: TẠO NGUỒN THAM KHẢO
        // Chỉ lấy các đoạn đã gửi cho Gemini.
        // ---------------------------------------------

        const sources = buildSources(
            usedChunks
        );

        // ---------------------------------------------
        // BƯỚC 5: GỬI CHO GEMINI
        // ---------------------------------------------

        const answer = await askGemini(
            userQuestion,
            documentContext,
            "Thư viện tài liệu đã được lập chỉ mục bằng JSONB"
        );

        if (
            !answer ||
            !String(answer).trim()
        ) {
            throw new Error(
                "AI không trả về nội dung câu trả lời."
            );
        }

        // ---------------------------------------------
        // BƯỚC 6: TRẢ KẾT QUẢ
        // ---------------------------------------------

        console.log(
            "AI tổng hợp thành công."
        );

        return res.status(200).json({
            success: true,

            message:
                "AI đã tổng hợp tài liệu thành công.",

            answer,

            sources,

            totalChunks: usedChunks.length,

            totalDocuments: sources.length,

            storage: "document_contents",

            searchMethod: "cosine_similarity_jsonb",
        });

    } catch (error) {
        console.error(
            "================================="
        );

        console.error(
            "CHAT CONTROLLER ERROR:",
            error
        );

        console.error(
            "================================="
        );

        return res.status(500).json({
            success: false,

            message:
                error.message ||
                "Không thể tổng hợp tài liệu.",

            error:
                process.env.NODE_ENV === "development"
                    ? error.stack
                    : undefined,
        });
    }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    chatWithDocument,
};
