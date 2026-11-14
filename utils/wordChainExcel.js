
const XLSX = require("xlsx");

const MAX_QUESTIONS = 1000;
const MAX_OPTIONS = 1000;

const normalizeText = (value) => {
    return String(value ?? "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ");
};

const normalizeKey = (value) => {
    return normalizeText(value).toUpperCase();
};

const normalizeWord = (value) => {
    return normalizeText(value).toLocaleLowerCase("vi");
};

// =====================================================
// ĐỌC EXCEL GHÉP NỐI HAI CỘT
// Sheet: DU_LIEU
// =====================================================

const readMatchingFromExcel = (buffer) => {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error("File Excel không hợp lệ.");
    }

    let workbook;

    try {
        workbook = XLSX.read(buffer, {
            type: "buffer",
        });
    } catch (error) {
        throw new Error("Không thể đọc file Excel.");
    }

    if (!workbook.SheetNames.includes("DU_LIEU")) {
        throw new Error(
            "Không tìm thấy sheet DU_LIEU trong file Excel."
        );
    }

    const sheet = workbook.Sheets["DU_LIEU"];

    const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
    });

    if (rows.length < 2) {
        throw new Error("Sheet DU_LIEU không có dữ liệu.");
    }

    const headers = rows[0].map(normalizeKey);

    const requiredColumns = [
        "STT",
        "NOI_DUNG_COT_SO",
        "DAP_AN_DUNG",
        "KY_HIEU_COT_CHU",
        "NOI_DUNG_COT_CHU",
    ];

    const columnIndexes = {};

    for (const column of requiredColumns) {
        const index = headers.indexOf(column);

        if (index === -1) {
            throw new Error(
                `File Excel thiếu cột ${column}.`
            );
        }

        columnIndexes[column] = index;
    }

    const questions = [];
    const options = [];

    const questionIds = new Set();
    const optionKeys = new Set();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        const questionId = normalizeText(
            row[columnIndexes.STT]
        );

        const leftText = normalizeText(
            row[columnIndexes.NOI_DUNG_COT_SO]
        );

        const correctKey = normalizeKey(
            row[columnIndexes.DAP_AN_DUNG]
        );

        const optionKey = normalizeKey(
            row[columnIndexes.KY_HIEU_COT_CHU]
        );

        const rightText = normalizeText(
            row[columnIndexes.NOI_DUNG_COT_CHU]
        );

        const excelRow = i + 1;

        // Bỏ qua dòng hoàn toàn trống
        if (
            !questionId &&
            !leftText &&
            !correctKey &&
            !optionKey &&
            !rightText
        ) {
            continue;
        }

        // Kiểm tra đủ dữ liệu
        if (
            !questionId ||
            !leftText ||
            !correctKey ||
            !optionKey ||
            !rightText
        ) {
            throw new Error(
                `Dữ liệu không đầy đủ tại dòng ${excelRow}.`
            );
        }

        if (
            leftText.length > 5000 ||
            rightText.length > 5000
        ) {
            throw new Error(
                `Nội dung tại dòng ${excelRow} quá dài.`
            );
        }

        if (questionIds.has(questionId)) {
            throw new Error(
                `STT ${questionId} bị trùng tại dòng ${excelRow}.`
            );
        }

        if (optionKeys.has(optionKey)) {
            throw new Error(
                `Mã phương án ${optionKey} bị trùng tại dòng ${excelRow}.`
            );
        }

        if (
            correctKey !== "0" &&
            !/^[A-Z0-9]+$/.test(correctKey)
        ) {
            throw new Error(
                `Mã đáp án không hợp lệ tại dòng ${excelRow}.`
            );
        }

        if (!/^[A-Z0-9]+$/.test(optionKey)) {
            throw new Error(
                `Mã phương án không hợp lệ tại dòng ${excelRow}.`
            );
        }

        questionIds.add(questionId);
        optionKeys.add(optionKey);

        questions.push({
            id: Number(questionId) || questionId,
            left_text: leftText,
            correct_option_key: correctKey,
        });

        options.push({
            option_key: optionKey,
            right_text: rightText,
        });

        if (questions.length > MAX_QUESTIONS) {
            throw new Error(
                `File chỉ được chứa tối đa ${MAX_QUESTIONS} câu hỏi.`
            );
        }

        if (options.length > MAX_OPTIONS) {
            throw new Error(
                `File chỉ được chứa tối đa ${MAX_OPTIONS} phương án.`
            );
        }
    }

    // Bắt buộc ít nhất một câu hỏi
    if (questions.length < 1) {
        throw new Error(
            "Quiz cần có ít nhất một câu hỏi."
        );
    }

    // Bắt buộc ít nhất một phương án
    if (options.length < 1) {
        throw new Error(
            "Quiz cần có ít nhất một đáp án."
        );
    }

    // Kiểm tra đáp án đúng tồn tại
    for (const question of questions) {
        if (
            question.correct_option_key !== "0" &&
            !optionKeys.has(question.correct_option_key)
        ) {
            throw new Error(
                `Câu ${question.id} có đáp án ${question.correct_option_key} nhưng không tồn tại phương án tương ứng.`
            );
        }
    }

    return {
        game_type: "MATCHING",
        questions,
        options,
        total_questions: questions.length,
        total_options: options.length,
    };
};

// =====================================================
// ĐỌC FILE NỐI TỪ CŨ
// Giữ lại để tương thích dữ liệu cũ
// =====================================================

const readWordsFromExcel = (buffer) => {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error("File Excel không hợp lệ.");
    }

    const workbook = XLSX.read(buffer, {
        type: "buffer",
    });

    if (!workbook.SheetNames.length) {
        throw new Error("File Excel không có sheet.");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
    });

    if (!rows.length) {
        throw new Error("File Excel không có dữ liệu.");
    }

    const headers = rows[0].map(normalizeWord);

    const acceptedHeaders = [
        "word",
        "từ",
        "tu",
        "từ vựng",
        "vocabulary",
    ];

    const headerIndex = headers.findIndex((item) =>
        acceptedHeaders.includes(item)
    );

    const columnIndex = headerIndex === -1 ? 0 : headerIndex;
    const startRow = headerIndex === -1 ? 0 : 1;

    const words = [];
    const seen = new Set();

    for (let i = startRow; i < rows.length; i++) {
        const originalWord = normalizeText(
            rows[i][columnIndex]
        );

        if (!originalWord) continue;

        const normalizedWord = normalizeWord(originalWord);

        if (normalizedWord.length > 255) {
            throw new Error(
                `Từ tại dòng ${i + 1} quá dài.`
            );
        }

        if (seen.has(normalizedWord)) {
            throw new Error(
                `Từ "${originalWord}" bị trùng tại dòng ${i + 1}.`
            );
        }

        seen.add(normalizedWord);

        words.push({
            word: originalWord,
            normalized_word: normalizedWord,
            word_order: words.length + 1,
        });

        if (words.length > MAX_QUESTIONS) {
            throw new Error(
                `File chỉ được chứa tối đa ${MAX_QUESTIONS} từ.`
            );
        }
    }

    if (!words.length) {
        throw new Error("Không tìm thấy từ vựng hợp lệ.");
    }

    return words;
};

module.exports = {
    readMatchingFromExcel,
    readWordsFromExcel,
    normalizeWord,
    normalizeText,
};
