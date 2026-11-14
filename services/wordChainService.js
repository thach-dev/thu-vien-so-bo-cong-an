
const supabase = require("../config/supabase");

const TABLE_NAME = "word_chain_sets";

// =====================================================
// 1. CHUẨN HÓA TỪ
// =====================================================

const normalizeWord = (word) => {
    return String(word || "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("vi");
};

// =====================================================
// 2. CHUẨN HÓA DANH SÁCH TỪ
// Một bộ từ được lưu trong một dòng JSONB
// =====================================================

const normalizeWords = (words) => {
    if (!Array.isArray(words)) {
        throw new Error("Danh sách từ phải là một mảng.");
    }

    const seen = new Set();
    const result = [];

    for (const item of words) {
        const rawWord =
            typeof item === "string"
                ? item
                : item?.word;

        if (typeof rawWord !== "string") {
            continue;
        }

        const word = rawWord
            .normalize("NFC")
            .trim()
            .replace(/\s+/g, " ");

        const normalizedWord = normalizeWord(word);

        // Bỏ từ rỗng và từ trùng
        if (
            !word ||
            !normalizedWord ||
            seen.has(normalizedWord)
        ) {
            continue;
        }

        seen.add(normalizedWord);

        result.push({
            word,
            normalized_word: normalizedWord,
            word_order: result.length + 1,
        });
    }

    if (result.length === 0) {
        throw new Error(
            "Danh sách từ không có dữ liệu hợp lệ."
        );
    }

    if (result.length > 1000) {
        throw new Error(
            "Một bộ từ không được vượt quá 1000 từ."
        );
    }

    return result;
};

// =====================================================
// 3. LẤY DANH SÁCH BỘ TỪ CÓ THỂ CHƠI
// GET /api/word-chain/sets
// =====================================================

const getApprovedWordSets = async () => {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select(`
            id,
            title,
            description,
            total_words,
            status,
            created_at
        `)
        .eq("status", "APPROVED")
        .order("created_at", {
            ascending: false,
        });

    if (error) {
        console.error(
            "SUPABASE GET WORD SETS ERROR:",
            error
        );

        throw error;
    }

    return data || [];
};

// =====================================================
// 4. LẤY CHI TIẾT BỘ TỪ
// GET /api/word-chain/sets/:id
// =====================================================

const getWordSetById = async (id) => {
    if (!id) {
        throw new Error("Thiếu ID bộ từ.");
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("*")
        .eq("id", id)
        .eq("status", "APPROVED")
        .maybeSingle();

    if (error) {
        console.error(
            "SUPABASE GET WORD SET DETAIL ERROR:",
            error
        );

        throw error;
    }

    if (!data) {
        throw new Error(
            "Không tìm thấy bộ từ."
        );
    }

    return data;
};

// =====================================================
// 5. LẤY BỘ TỪ CHO HOST TẠO PHÒNG RENDER
// =====================================================

const getWordSetForHost = async (id) => {
    const data = await getWordSetById(id);

    const words = normalizeWords(data.words);

    return {
        id: data.id,
        title: data.title,
        total_words: words.length,
        words,
    };
};

// =====================================================
// 6. TẠO BỘ TỪ MỚI
// Upload thành công là APPROVED ngay
// Một bộ từ = một dòng JSONB
// =====================================================

const createWordSet = async ({
    title,
    description,
    uploaderId,
    words,
}) => {
    // Kiểm tra tên bộ từ
    if (
        !title ||
        typeof title !== "string" ||
        !title.trim()
    ) {
        throw new Error(
            "Tên bộ từ không hợp lệ."
        );
    }

    const cleanTitle = title.trim();

    if (cleanTitle.length > 255) {
        throw new Error(
            "Tên bộ từ không được vượt quá 255 ký tự."
        );
    }

    // Chuẩn hóa danh sách từ
    const normalizedWords = normalizeWords(words);

    // Dữ liệu lưu Supabase
    const payload = {
        title: cleanTitle,

        description:
            typeof description === "string" &&
            description.trim()
                ? description.trim()
                : null,

        uploader_id: uploaderId || null,

        // Không cần chờ ADMIN duyệt
        status: "APPROVED",

        total_words: normalizedWords.length,

        // Lưu toàn bộ danh sách vào JSONB
        words: normalizedWords,
    };

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .insert(payload)
        .select(`
            id,
            title,
            description,
            status,
            total_words,
            created_at
        `)
        .single();

    if (error) {
        console.error(
            "SUPABASE CREATE WORD SET ERROR:",
            error
        );

        throw error;
    }

    if (!data) {
        throw new Error(
            "Supabase không trả về dữ liệu bộ từ vừa tạo."
        );
    }

    return data;
};

// =====================================================
// 7. XÓA BỘ TỪ
// =====================================================

const deleteWordSet = async (id) => {
    if (!id) {
        throw new Error(
            "Thiếu ID bộ từ cần xóa."
        );
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

    if (error) {
        console.error(
            "SUPABASE DELETE WORD SET ERROR:",
            error
        );

        throw error;
    }

    if (!data) {
        throw new Error(
            "Bộ từ không tồn tại hoặc không thể xóa."
        );
    }

    return data;
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    getApprovedWordSets,
    getWordSetById,
    getWordSetForHost,
    createWordSet,
    deleteWordSet,
};
