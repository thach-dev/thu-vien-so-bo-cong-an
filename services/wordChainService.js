
const supabase = require("../config/supabase");

const TABLE_NAME = "word_chain_sets";

const MAX_QUESTIONS = 1000;
const MAX_OPTIONS = 1000;

// =====================================================
// 1. CHUẨN HÓA TỪ CŨ
// =====================================================

const normalizeWord = (word) => {
    return String(word ?? "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("vi");
};

// =====================================================
// 2. CHUẨN HÓA DANH SÁCH TỪ CŨ
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

        if (typeof rawWord !== "string") continue;

        const word = rawWord
            .normalize("NFC")
            .trim()
            .replace(/\s+/g, " ");

        const normalizedWord = normalizeWord(word);

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

    if (result.length < 1) {
        throw new Error(
            "Danh sách từ không có dữ liệu hợp lệ."
        );
    }

    if (result.length > MAX_QUESTIONS) {
        throw new Error(
            "Một bộ từ không được vượt quá 1000 từ."
        );
    }

    return result;
};

// =====================================================
// 3. CHUẨN HÓA DỮ LIỆU GHÉP NỐI
// =====================================================

const normalizeMatchingData = (gameData) => {
    if (
        !gameData ||
        typeof gameData !== "object" ||
        Array.isArray(gameData) ||
        gameData.game_type !== "MATCHING"
    ) {
        throw new Error(
            "Dữ liệu game ghép nối không hợp lệ."
        );
    }

    if (
        !Array.isArray(gameData.questions) ||
        gameData.questions.length < 1
    ) {
        throw new Error(
            "Quiz cần có ít nhất một câu hỏi."
        );
    }

    if (
        !Array.isArray(gameData.options) ||
        gameData.options.length < 1
    ) {
        throw new Error(
            "Quiz cần có ít nhất một đáp án."
        );
    }

    if (
        gameData.questions.length > MAX_QUESTIONS ||
        gameData.options.length > MAX_OPTIONS
    ) {
        throw new Error(
            "Bộ ghép nối không được vượt quá 1000 câu hỏi hoặc phương án."
        );
    }

    // Chuẩn hóa phương án
    const optionKeys = new Set();

    const options = gameData.options.map((item, index) => {
        const optionKey = String(
            item?.option_key ?? ""
        )
            .trim()
            .toUpperCase();

        const rightText = String(
            item?.right_text ?? ""
        )
            .normalize("NFC")
            .trim()
            .replace(/\s+/g, " ");

        if (!optionKey || !rightText) {
            throw new Error(
                `Phương án thứ ${index + 1} không hợp lệ.`
            );
        }

        if (!/^[A-Z0-9]+$/.test(optionKey)) {
            throw new Error(
                `Mã phương án ${optionKey} không hợp lệ.`
            );
        }

        if (rightText.length > 5000) {
            throw new Error(
                `Nội dung phương án ${optionKey} quá dài.`
            );
        }

        if (optionKeys.has(optionKey)) {
            throw new Error(
                `Mã phương án ${optionKey} bị trùng.`
            );
        }

        optionKeys.add(optionKey);

        return {
            option_key: optionKey,
            right_text: rightText,
        };
    });

    // Chuẩn hóa câu hỏi
    const questionIds = new Set();

    const questions = gameData.questions.map((item, index) => {
        const id = item?.id ?? index + 1;

        const leftText = String(
            item?.left_text ?? ""
        )
            .normalize("NFC")
            .trim()
            .replace(/\s+/g, " ");

        const correctKey = String(
            item?.correct_option_key ?? ""
        )
            .trim()
            .toUpperCase();

        if (!leftText || !correctKey) {
            throw new Error(
                `Câu hỏi thứ ${index + 1} không hợp lệ.`
            );
        }

        if (String(id).length > 100) {
            throw new Error(
                `ID câu hỏi thứ ${index + 1} quá dài.`
            );
        }

        if (leftText.length > 5000) {
            throw new Error(
                `Nội dung câu hỏi thứ ${index + 1} quá dài.`
            );
        }

        if (questionIds.has(String(id))) {
            throw new Error(
                `ID câu hỏi ${id} bị trùng.`
            );
        }

        if (
            correctKey !== "0" &&
            !/^[A-Z0-9]+$/.test(correctKey)
        ) {
            throw new Error(
                `Mã đáp án của câu ${id} không hợp lệ.`
            );
        }

        if (
            correctKey !== "0" &&
            !optionKeys.has(correctKey)
        ) {
            throw new Error(
                `Câu ${id} có đáp án ${correctKey} không tồn tại.`
            );
        }

        questionIds.add(String(id));

        return {
            id,
            left_text: leftText,
            correct_option_key: correctKey,
        };
    });

    return {
        game_type: "MATCHING",
        questions,
        options,
        total_questions: questions.length,
        total_options: options.length,
    };
};

// =====================================================
// 4. LẤY DANH SÁCH BỘ DỮ LIỆU ĐÃ APPROVED
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
// 5. LẤY CHI TIẾT BỘ DỮ LIỆU
// =====================================================

const getWordSetById = async (id) => {
    if (!id) {
        throw new Error("Thiếu ID bộ dữ liệu.");
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
            "Không tìm thấy bộ dữ liệu."
        );
    }

    return data;
};

// =====================================================
// 6. LẤY DỮ LIỆU CHO HOST TẠO PHÒNG
// =====================================================

const getWordSetForHost = async (id) => {
    const data = await getWordSetById(id);

    // Dữ liệu ghép nối mới
    if (
        data.words &&
        !Array.isArray(data.words) &&
        data.words.game_type === "MATCHING"
    ) {
        const matchingData = normalizeMatchingData(
            data.words
        );

        return {
            id: data.id,
            title: data.title,
            game_type: "MATCHING",
            total_questions: matchingData.total_questions,
            total_options: matchingData.total_options,
            questions: matchingData.questions,
            options: matchingData.options,
        };
    }

    // Dữ liệu cũ không được dùng để tạo phòng ghép nối
    if (!Array.isArray(data.words)) {
        throw new Error(
            "Bộ dữ liệu không đúng định dạng ghép nối."
        );
    }

    const words = normalizeWords(data.words);

    return {
        id: data.id,
        title: data.title,
        game_type: "WORD_CHAIN",
        total_words: words.length,
        words,
    };
};

// =====================================================
// 7. TẠO BỘ DỮ LIỆU
// Một bộ = một dòng JSONB
// =====================================================

const createWordSet = async ({
    title,
    description,
    uploaderId,
    gameData,
}) => {
    if (
        !title ||
        typeof title !== "string" ||
        !title.trim()
    ) {
        throw new Error(
            "Tên bộ dữ liệu không hợp lệ."
        );
    }

    const cleanTitle = title.trim();

    if (cleanTitle.length > 255) {
        throw new Error(
            "Tên bộ dữ liệu không được vượt quá 255 ký tự."
        );
    }

    const normalizedData = normalizeMatchingData(gameData);

    const payload = {
        title: cleanTitle,

        description:
            typeof description === "string" &&
            description.trim()
                ? description.trim()
                : null,

        uploader_id: uploaderId || null,

        status: "APPROVED",

        total_words: normalizedData.total_questions,

        // Toàn bộ câu hỏi và phương án lưu trong JSONB
        words: normalizedData,
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
            "SUPABASE CREATE MATCHING SET ERROR:",
            error
        );

        throw error;
    }

    if (!data) {
        throw new Error(
            "Supabase không trả về bộ dữ liệu vừa tạo."
        );
    }

    return {
        ...data,
        game_type: "MATCHING",
        total_questions: normalizedData.total_questions,
        total_options: normalizedData.total_options,
    };
};

// =====================================================
// 8. XÓA BỘ DỮ LIỆU
// =====================================================

const deleteWordSet = async (id) => {
    if (!id) {
        throw new Error(
            "Thiếu ID bộ dữ liệu cần xóa."
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
            "Bộ dữ liệu không tồn tại hoặc không thể xóa."
        );
    }

    return data;
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    normalizeWord,
    normalizeWords,
    normalizeMatchingData,
    getApprovedWordSets,
    getWordSetById,
    getWordSetForHost,
    createWordSet,
    deleteWordSet,
};
