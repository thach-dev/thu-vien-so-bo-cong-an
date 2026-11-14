
const XLSX = require("xlsx");

const MAX_WORDS = 1000;

const normalizeWord = (value) => {
    return String(value || "")
        .normalize("NFC")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
};

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
        const originalWord = String(
            rows[i][columnIndex] || ""
        ).trim();

        if (!originalWord) continue;

        const normalizedWord = normalizeWord(originalWord);

        if (normalizedWord.length > 255) {
            throw new Error(`Từ tại dòng ${i + 1} quá dài.`);
        }

        if (seen.has(normalizedWord)) {
            throw new Error(
                `Từ "${originalWord}" bị trùng tại dòng ${i + 1}.`
            );
        }

        seen.add(normalizedWord);

        words.push({
            word: originalWord.normalize("NFC"),
            normalized_word: normalizedWord,
            word_order: words.length + 1,
        });

        if (words.length > MAX_WORDS) {
            throw new Error(
                `File chỉ được chứa tối đa ${MAX_WORDS} từ.`
            );
        }
    }

    if (!words.length) {
        throw new Error("Không tìm thấy từ vựng hợp lệ.");
    }

    return words;
};

module.exports = {
    readWordsFromExcel,
    normalizeWord,
};
