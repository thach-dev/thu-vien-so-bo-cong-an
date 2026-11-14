
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

        if (!title || typeof title !== "string" || !title.trim()) {
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

        if (!req.file?.buffer) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng chọn file Excel.",
            });
        }

        let words;

        try {
            words = readWordsFromExcel(req.file.buffer);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: error.message || "Không thể đọc dữ liệu Excel.",
            });
        }

        if (!Array.isArray(words) || words.length === 0) {
            return res.status(400).json({
                success: false,
                message: "File Excel không có từ vựng hợp lệ.",
            });
        }

        const uploaderId =
            req.user?.id ||
            req.user?.userId ||
            req.user?.user_id ||
            null;

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
            message: "Upload bộ từ thành công. Bộ từ đang chờ quản trị viên duyệt.",
            data: result,
        });

    } catch (error) {
        console.error("Upload word set error:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể upload bộ từ.",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

// =====================================================
// 2. LẤY DANH SÁCH BỘ TỪ ĐÃ DUYỆT
// =====================================================

const getWordSets = async (req, res) => {
    try {
        const data = await getApprovedWordSets();

        return res.status(200).json({
            success: true,
            total: data.length,
            data,
        });

    } catch (error) {
        console.error("Get word sets error:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách bộ từ.",
        });
    }
};

// =====================================================
// 3. XEM CHI TIẾT BỘ TỪ
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

        return res.status(200).json({
            success: true,
            data,
        });

    } catch (error) {
        console.error("Get word set detail error:", error);

        return res.status(404).json({
            success: false,
            message: "Không tìm thấy bộ từ hoặc bộ từ chưa được duyệt.",
        });
    }
};

// =====================================================
// 4. XÓA BỘ TỪ
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
        console.error("Delete word set error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể xóa bộ từ.",
        });
    }
};

module.exports = {
    uploadWordSet,
    getWordSets,
    getWordSetDetail,
    removeWordSet,
};
