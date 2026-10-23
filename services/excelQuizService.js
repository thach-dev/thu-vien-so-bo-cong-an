const XLSX = require("xlsx");
const { randomUUID } = require("crypto");

function parseCorrectAnswer(value, rowNumber) {
  const answer = String(value ?? "").trim().toUpperCase();

  const answerMap = {
    A: 0,
    B: 1,
    C: 2,
    D: 3,
    "0": 0,
    "1": 1,
    "2": 2,
    "3": 3,
  };

  if (!Object.prototype.hasOwnProperty.call(answerMap, answer)) {
    throw new Error(
      `Dòng ${rowNumber}: đáp án đúng phải là A, B, C, D hoặc 0, 1, 2, 3.`
    );
  }

  return answerMap[answer];
}

function readQuestionsFromExcel(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("File Excel đang trống.");
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("File Excel không có sheet dữ liệu.");
  }

  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[sheetName],
    { defval: "", raw: false }
  );

  if (rows.length === 0) {
    throw new Error("File Excel chưa có câu hỏi.");
  }

  if (rows.length > 50) {
    throw new Error("Một bộ Quiz không được vượt quá 50 câu.");
  }

  return rows.map((source, index) => {
    const rowNumber = index + 2;
    const normalized = {};

    for (const [key, value] of Object.entries(source)) {
      normalized[String(key).trim().toLowerCase().replace(/[\s-]+/g, "_")] = value;
    }

    const questionText = String(
      normalized.question_text ?? normalized.question ?? ""
    ).trim();

    const answers = [
      normalized.answer_a ?? normalized.a,
      normalized.answer_b ?? normalized.b,
      normalized.answer_c ?? normalized.c,
      normalized.answer_d ?? normalized.d,
    ].map((value) => String(value ?? "").trim());

    if (!questionText) {
      throw new Error(`Dòng ${rowNumber}: thiếu nội dung câu hỏi.`);
    }

    if (answers.some((answer) => !answer)) {
      throw new Error(`Dòng ${rowNumber}: cần đủ 4 đáp án A, B, C, D.`);
    }

    return {
      id: randomUUID(),
      question_text: questionText,
      answers,
      correct_answer: parseCorrectAnswer(
        normalized.correct_answer,
        rowNumber
      ),
      time_limit: 20,
      points: 1000,
      question_order: index + 1,
    };
  });
}

module.exports = { readQuestionsFromExcel };