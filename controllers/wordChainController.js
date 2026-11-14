
const {
    readWordsFromExcel,
} = require("../utils/wordChainExcel");

const {
    createWordSet,
    getApprovedWordSets,
    getWordSetById,
    deleteWordSet,
} = require("../services/wordChainService");

// =====================================================
// 1. UPLOAD BỘ TỪ EXCEL
// Công khai, không bắt buộc đăng nhập
// =====================================================

const uploadWordSet = async (req, res) => {
    try {
        const { title, description } = req.body || {};

        // Kiểm tra tên bộ từ
        if (
            !title ||
            typeof title !== "string" ||
            !title.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập tên bộ từ.",
            });
        }

        if (title.trim().length > 255) {
            return res.status(400).json({
                success: false,
                message: "Tên bộ từ không được vượt quá 255 ký tự.",
            });
        }

        // Kiểm tra file Excel
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng chọn file Excel.",
            });
        }

        // Đọc dữ liệu Excel
        let words;

        try {
            words = readWordsFromExcel(req.file.buffer);
        } catch (error) {
            console.error("READ EXCEL ERROR:", error);

            return res.status(400).json({
                success: false,
                message:
                    error.message ||
                    "Không thể đọc dữ liệu Excel.",
            });
        }

        if (!Array.isArray(words) || words.length === 0) {
            return res.status(400).json({
                success: false,
                message: "File Excel không có từ vựng hợp lệ.",
            });
        }

        // Lấy ID người upload nếu có đăng nhập
        const uploaderId =
            req.user?.id ||
            req.user?.userId ||
            req.user?.user_id ||
            null;

        // Lưu bộ từ vào Supabase
        const result = await createWordSet({
            title: title.trim(),
            description:
                typeof description === "string"
                    ? description.trim()
                    : null,
            uploaderId,
            words,
        });

        return res.status(201).json({
            success: true,
            message:
                "Upload bộ từ thành công. Bộ từ đang chờ quản trị viên duyệt.",
            data: result,
        });

    } catch (error) {
        console.error("UPLOAD WORD SET ERROR:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            stack: error.stack,
        });

        return res.status(500).json({
            success: false,
            message: "Không thể upload bộ từ.",
            error: error.message || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// 2. LẤY DANH SÁCH BỘ TỪ ĐÃ DUYỆT
// GET /api/word-chain/sets
// =====================================================

const getWordSets = async (req, res) => {
    try {
        const data = await getApprovedWordSets();

        // Đảm bảo dữ liệu trả về là mảng
        const wordSets = Array.isArray(data) ? data : [];

        return res.status(200).json({
            success: true,
            total: wordSets.length,
            data: wordSets,
        });

    } catch (error) {
        console.error("GET WORD SETS ERROR:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            stack: error.stack,
        });

        // Tạm thời trả lỗi chi tiết để kiểm tra nguyên nhân
        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách bộ từ.",
            error: error.message || null,
            details: error.details || null,
            hint: error.hint || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// 3. XEM CHI TIẾT BỘ TỪ
// GET /api/word-chain/sets/:id
// =====================================================

const getWordSetDetail = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID bộ từ.",
            });
        }

        const data = await getWordSetById(id);

        if (!data) {
            return res.status(404).json({
                success: false,
                message:
                    "Không tìm thấy bộ từ hoặc bộ từ chưa được duyệt.",
            });
        }

        return res.status(200).json({
            success: true,
            data,
        });

    } catch (error) {
        console.error("GET WORD SET DETAIL ERROR:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            stack: error.stack,
        });

        return res.status(500).json({
            success: false,
            message: "Không thể lấy chi tiết bộ từ.",
            error: error.message || null,
            code: error.code || null,
        });
    }
};

// =====================================================
// 4. XÓA BỘ TỪ
// DELETE /api/word-chain/sets/:id
// Route phải có requireAdmin
// =====================================================

const removeWordSet = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID bộ từ cần xóa.",
            });
        }

        await deleteWordSet(id);

        return res.status(200).json({
            success: true,
            message: "Đã xóa bộ từ.",
        });

    } catch (error) {
        console.error("DELETE WORD SET ERROR:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            stack: error.stack,
        });

        return res.status(500).json({
            success: false,
            message: "Không thể xóa bộ từ.",
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
