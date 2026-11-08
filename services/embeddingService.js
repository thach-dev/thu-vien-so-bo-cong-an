
const { GoogleGenAI } = require("@google/genai");

const MODEL_NAME = "gemini-embedding-001";
const OUTPUT_DIMENSIONALITY = 768;

let genAI = null;

const getAI = () => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Chưa cấu hình GEMINI_API_KEY.");
    }

    if (!genAI) {
        genAI = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
        });
    }

    return genAI;
};

// Chuẩn hóa vector về độ dài 1.
const normalizeEmbedding = (values) => {
    if (!Array.isArray(values) || values.length !== OUTPUT_DIMENSIONALITY) {
        throw new Error("Vector embedding không đúng 768 chiều.");
    }

    const magnitude = Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0)
    );

    if (!magnitude) {
        throw new Error("Vector embedding không hợp lệ.");
    }

    return values.map((value) => value / magnitude);
};

// Tạo embedding cho nội dung tài liệu.
const generateDocumentEmbedding = async (text, title = "") => {
    if (!text || !String(text).trim()) {
        throw new Error("Nội dung cần tạo embedding đang trống.");
    }

    const response = await getAI().models.embedContent({
        model: MODEL_NAME,
        contents: String(text),
        config: {
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: OUTPUT_DIMENSIONALITY,
            title: String(title || "Tài liệu thư viện"),
        },
    });

    const values = response.embeddings?.[0]?.values;

    return normalizeEmbedding(values);
};

// Tạo embedding cho câu hỏi tìm kiếm.
const generateQueryEmbedding = async (question) => {
    if (!question || !String(question).trim()) {
        throw new Error("Vui lòng nhập câu hỏi tìm kiếm.");
    }

    const response = await getAI().models.embedContent({
        model: MODEL_NAME,
        contents: String(question),
        config: {
            taskType: "RETRIEVAL_QUERY",
            outputDimensionality: OUTPUT_DIMENSIONALITY,
        },
    });

    const values = response.embeddings?.[0]?.values;

    return normalizeEmbedding(values);
};

module.exports = {
    generateDocumentEmbedding,
    generateQueryEmbedding,
};
