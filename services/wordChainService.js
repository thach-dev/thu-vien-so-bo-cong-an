
const { supabase } = require("../config/supabase");

const TABLE_NAME = "word_chain_sets";

// =====================================================
// 1. LẤY DANH SÁCH BỘ TỪ ĐÃ DUYỆT
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
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    return data || [];
};

// =====================================================
// 2. LẤY CHI TIẾT BỘ TỪ ĐÃ DUYỆT
// =====================================================

const getWordSetById = async (id) => {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("*")
        .eq("id", id)
        .eq("status", "APPROVED")
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        throw new Error("Không tìm thấy bộ từ hoặc bộ từ chưa được duyệt.");
    }

    return data;
};

// =====================================================
// 3. LẤY BỘ TỪ CHO SOCKET HOST TẠO PHÒNG
// =====================================================

const getWordSetForHost = async (id) => {
    const data = await getWordSetById(id);

    if (!Array.isArray(data.words) || data.words.length === 0) {
        throw new Error("Bộ từ này chưa có dữ liệu.");
    }

    return {
        id: data.id,
        title: data.title,
        total_words: data.total_words,
        words: data.words
            .map((item, index) => {
                const word = typeof item === "string"
                    ? item
                    : item.word;

                if (!word || typeof word !== "string") {
                    return null;
                }

                return {
                    word: word.trim(),
                    normalized_word:
                        (item.normalized_word || word)
                            .normalize("NFC")
                            .trim()
                            .toLocaleLowerCase("vi"),
                    word_order: item.word_order || index + 1,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.word_order - b.word_order),
    };
};

// =====================================================
// 4. TẠO BỘ TỪ MỚI
// Một bộ từ = một dòng JSONB
// Mặc định chờ ADMIN duyệt
// =====================================================

const createWordSet = async ({
    title,
    description,
    uploaderId,
    words,
}) => {
    if (!Array.isArray(words) || words.length === 0) {
        throw new Error("Danh sách từ không hợp lệ.");
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .insert({
            title: title.trim(),
            description: description || null,
            uploader_id: uploaderId || null,
            status: "PENDING",
            total_words: words.length,
            words: words,
        })
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
        throw error;
    }

    return data;
};

// =====================================================
// 5. XÓA BỘ TỪ
// =====================================================

const deleteWordSet = async (id) => {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        throw new Error("Bộ từ không tồn tại.");
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
