
const { randomUUID } = require("crypto");
const XLSX = require("xlsx");

function normalizeKey(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function parseCorrectAnswer(value) {
  const answer = String(value ?? "").trim().toUpperCase();

  const answerMap = {
    A: 0,
    B: 1,
    C: 2,
    D: 3,
  };

  if (Object.prototype.hasOwnProperty.call(answerMap, answer)) {
    return answerMap[answer];
  }

  if (/^[0-3]$/.test(answer)) {
    return Number(answer);
  }

  throw new Error("Đáp án đúng phải là 0, 1, 2, 3 hoặc A, B, C, D.");
}

function readQuestionsFromExcel(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
  });

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("File Excel không có sheet dữ liệu.");
  }

  const worksheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error("File Excel chưa có câu hỏi.");
  }

  return rows.map((source, index) => {
    const row = {};

    for (const [key, value] of Object.entries(source)) {
      row[normalizeKey(key)] = value;
    }

    const questionText = String(row.question_text ?? "").trim();

    const answers = [
      row.answer_a,
      row.answer_b,
      row.answer_c,
      row.answer_d,
    ].map((answer) => String(answer ?? "").trim());

    const rowNumber = index + 2;

    if (!questionText) {
      throw new Error(`Dòng ${rowNumber}: chưa nhập nội dung câu hỏi.`);
    }

    if (answers.some((answer) => !answer)) {
      throw new Error(`Dòng ${rowNumber}: phải có đủ 4 đáp án.`);
    }

    let correctAnswer;

    try {
      correctAnswer = parseCorrectAnswer(row.correct_answer);
    } catch (error) {
      throw new Error(`Dòng ${rowNumber}: ${error.message}`);
    }

    return {
      id: randomUUID(),
      points: 1000,
      answers,
      time_limit: 20,
      question_text: questionText,
      correct_answer: correctAnswer,
      question_order: index + 1,
    };
  });
}

module.exports = {
  readQuestionsFromExcel,
};
