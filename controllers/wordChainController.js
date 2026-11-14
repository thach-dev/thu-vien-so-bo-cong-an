
const {
    readMatchingFromExcel,
} = require("../utils/wordChainExcel");

const {
    createWordSet,
    getApprovedWordSets,
    getWordSetById,
    deleteWordSet,
} = require("../services/wordChainService");

// =====================================================
// 1. UPLOAD EXCEL GHÉP NỐI
// Upload thành công tự động APPROVED
// =====================================================

const uploadWordSet = async (req, res) => {
    try {
        const { title, description } = req.body || {};

        if (
            !title ||
            typeof title !== "string" ||
            !title.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập tên bộ dữ liệu.",
            });
        }

        if (title.trim().length > 255) {
            return res.status(400).json({
                success: false,
                message: "Tên bộ dữ liệu không được vượt quá 255 ký tự.",
            });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng chọn file Excel.",
            });
        }

        // Đọc dữ liệu từ Excel
        let gameData;

        try {
            gameData = readMatchingFromExcel(req.file.buffer);
        } catch (error) {
            console.error("READ MATCHING EXCEL ERROR:", error);

            return res.status(400).json({
                success: false,
                message:
                    error.message ||
                    "Không thể đọc dữ liệu Excel.",
            });
        }

        // Kiểm tra cấu trúc dữ liệu
        if (!gameData || gameData.game_type !== "MATCHING") {
            return res.status(400).json({
                success: false,
                message: "File Excel không đúng định dạng ghép nối.",
            });
        }

        // Bắt buộc ít nhất một câu hỏi
        if (
            !Array.isArray(gameData.questions) ||
            gameData.questions.length < 1
        ) {
            return res.status(400).json({
                success: false,
                message: "Quiz cần có ít nhất một câu hỏi.",
            });
        }

        // Bắt buộc ít nhất một đáp án
        if (
            !Array.isArray(gameData.options) ||
            gameData.options.length < 1
        ) {
            return res.status(400).json({
                success: false,
                message: "Quiz cần có ít nhất một đáp án.",
            });
        }

        // Kiểm tra nội dung câu hỏi
        const invalidQuestion = gameData.questions.some(
            (question) =>
                !question ||
                !String(question.left_text || "").trim() ||
                question.id === undefined ||
                question.id === null
        );

        if (invalidQuestion) {
            return res.status(400).json({
                success: false,
                message: "Có câu hỏi bị thiếu nội dung hoặc mã câu hỏi.",
            });
        }

        // Kiểm tra nội dung đáp án
        const invalidOption = gameData.options.some(
            (option) =>
                !option ||
                !String(option.right_text || "").trim() ||
                option.option_key === undefined ||
                option.option_key === null
        );

        if (invalidOption) {
            return res.status(400).json({
                success: false,
                message: "Có đáp án bị thiếu nội dung hoặc mã đáp án.",
            });
        }

        // Kiểm tra đáp án đúng có tồn tại trong danh sách lựa chọn
        const optionKeys = new Set(
            gameData.options.map((option) =>
                String(option.option_key).trim()
            )
        );

        const invalidAnswer = gameData.questions.some((question) => {
            const answerKey = String(
                question.correct_option_key
            ).trim();

            return answerKey !== "0" && !optionKeys.has(answerKey);
        });

        if (invalidAnswer) {
            return res.status(400).json({
                success: false,
                message: "Có câu hỏi tham chiếu đến mã đáp án không tồn tại.",
            });
        }

        // Người upload
        const uploaderId =
            req.user?.id ||
            req.user?.userId ||
            req.user?.user_id ||
            null;

        // Chỉ lưu sau khi toàn bộ dữ liệu hợp lệ
        const result = await createWordSet({
            title: title.trim(),

            description:
                typeof description === "string"
                    ? description.trim()
                    : null,

            uploaderId,
            gameData,
        });

        return res.status(201).json({
            success: true,
            message:
                "Upload bộ ghép nối thành công. Bạn có thể vào kho game để chơi ngay.",
            data: result,
        });

    } catch (error) {
        console.error("UPLOAD MATCHING SET ERROR:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            stack: error.stack,
        });

        return res.status(500).json({
            success: false,
            message: "Không thể upload bộ ghép nối.",
            error: error.message || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// 2. DANH SÁCH BỘ DỮ LIỆU
// GET /api/word-chain/sets
// =====================================================

const getWordSets = async (req, res) => {
    try {
        const data = await getApprovedWordSets();

        const wordSets = Array.isArray(data) ? data : [];

        return res.status(200).json({
            success: true,
            total: wordSets.length,
            data: wordSets,
        });

    } catch (error) {
        console.error("GET WORD SETS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách bộ dữ liệu.",
            error: error.message || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// 3. CHI TIẾT BỘ DỮ LIỆU
// GET /api/word-chain/sets/:id
// =====================================================

const getWordSetDetail = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID bộ dữ liệu.",
            });
        }

        const data = await getWordSetById(id);

        return res.status(200).json({
            success: true,
            data,
        });

    } catch (error) {
        const notFound =
            error.message === "Không tìm thấy bộ dữ liệu.";

        return res.status(notFound ? 404 : 500).json({
            success: false,
            message: notFound
                ? error.message
                : "Không thể lấy chi tiết bộ dữ liệu.",
            error: error.message || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// 4. XÓA BỘ DỮ LIỆU
// DELETE /api/word-chain/sets/:id
// Route phải có requireAdmin
// =====================================================

const removeWordSet = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID bộ dữ liệu cần xóa.",
            });
        }

        await deleteWordSet(id);

        return res.status(200).json({
            success: true,
            message: "Đã xóa bộ dữ liệu.",
        });

    } catch (error) {
        console.error("DELETE WORD SET ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể xóa bộ dữ liệu.",
            error: error.message || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    uploadWordSet,
    getWordSets,
    getWordSetDetail,
    removeWordSet,
};
