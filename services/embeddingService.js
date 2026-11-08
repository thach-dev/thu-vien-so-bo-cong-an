
const { GoogleGenAI } = require("@google/genai");

// =====================================================
// CẤU HÌNH
// =====================================================

const MODEL_NAME = "gemini-embedding-001";

const OUTPUT_DIMENSIONALITY = 768;

let genAI = null;

// =====================================================
// 1. KHỞI TẠO GEMINI
// =====================================================

const getAI = () => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error(
            "Chưa cấu hình GEMINI_API_KEY."
        );
    }

    if (!genAI) {
        genAI = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
        });
    }

    return genAI;
};

// =====================================================
// 2. CHUẨN HÓA VECTOR
// =====================================================

const normalizeEmbedding = (values) => {
    if (
        !Array.isArray(values) ||
        values.length !== OUTPUT_DIMENSIONALITY
    ) {
        throw new Error(
            `Vector embedding phải có đúng ${OUTPUT_DIMENSIONALITY} chiều.`
        );
    }

    const vector = values.map(Number);

    if (
        vector.some(
            (value) => !Number.isFinite(value)
        )
    ) {
        throw new Error(
            "Vector embedding chứa giá trị không hợp lệ."
        );
    }

    const magnitude = Math.sqrt(
        vector.reduce(
            (sum, value) => sum + value * value,
            0
        )
    );

    if (
        !Number.isFinite(magnitude) ||
        magnitude === 0
    ) {
        throw new Error(
            "Không thể chuẩn hóa vector embedding."
        );
    }

    return vector.map(
        (value) => value / magnitude
    );
};

// =====================================================
// 3. LẤY VECTOR TỪ GEMINI
// =====================================================

const extractEmbeddingValues = (response) => {
    const values =
        response?.embeddings?.[0]?.values;

    if (!Array.isArray(values)) {
        throw new Error(
            "Gemini không trả về dữ liệu embedding hợp lệ."
        );
    }

    return normalizeEmbedding(values);
};

// =====================================================
// 4. EMBEDDING TÀI LIỆU
// =====================================================

const generateDocumentEmbedding = async (
    text,
    title = ""
) => {
    if (
        !text ||
        !String(text).trim()
    ) {
        throw new Error(
            "Nội dung cần tạo embedding đang trống."
        );
    }

    const response = await getAI().models.embedContent({
        model: MODEL_NAME,

        contents: String(text),

        config: {
            taskType: "RETRIEVAL_DOCUMENT",

            outputDimensionality: OUTPUT_DIMENSIONALITY,

            title: String(
                title || "Tài liệu thư viện"
            ),
        },
    });

    return extractEmbeddingValues(response);
};

// =====================================================
// 5. EMBEDDING CÂU HỎI
// =====================================================

const generateQueryEmbedding = async (
    question
) => {
    if (
        !question ||
        !String(question).trim()
    ) {
        throw new Error(
            "Vui lòng nhập câu hỏi tìm kiếm."
        );
    }

    const response = await getAI().models.embedContent({
        model: MODEL_NAME,

        contents: String(question),

        config: {
            taskType: "RETRIEVAL_QUERY",

            outputDimensionality: OUTPUT_DIMENSIONALITY,
        },
    });

    return extractEmbeddingValues(response);
};

// =====================================================
// 6. EXPORT
// =====================================================

module.exports = {
    generateDocumentEmbedding,

    generateQueryEmbedding,

    normalizeEmbedding,

    MODEL_NAME,

    OUTPUT_DIMENSIONALITY,
};
