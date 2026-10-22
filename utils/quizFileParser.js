
const mammoth = require("mammoth");

function shuffleArray(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function normalizeLine(line) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function parseQuizText(rawText) {
  const text = rawText
    .replace(/\r\n?/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  const lines = text
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);

  const questions = [];
  let current = null;

  function saveQuestion() {
    if (!current) return;

    if (!current.question) {
      current = null;
      return;
    }

    const options = ["A", "B", "C", "D", "E", "F"];
    const answerEntries = Object.entries(current.answers);

    if (answerEntries.length < 2) {
      throw new Error(
        `Câu "${current.question}" có ít hơn 2 lựa chọn đáp án.`
      );
    }

    const correctLabel = current.correctLabel?.toUpperCase();

    if (!correctLabel || !current.answers[correctLabel]) {
      throw new Error(
        `Chưa tìm thấy đáp án đúng hợp lệ cho câu: ${current.question}`
      );
    }

    // Chuyển các lựa chọn thành dữ liệu nội bộ.
    const answers = answerEntries.map(([label, answer]) => ({
      label,
      text: answer,
      isCorrect: label === correctLabel,
    }));

    // Trộn đáp án, nhưng mang theo dấu isCorrect để không chấm sai.
    const shuffledAnswers = shuffleArray(answers);

    questions.push({
      question: current.question,
      answers: shuffledAnswers.map((answer) => answer.text),
      correctAnswer: shuffledAnswers.findIndex(
        (answer) => answer.isCorrect
      ),
      explanation: "",
      timeLimit: 20,
      points: 1000,
    });

    current = null;
  }

  for (const line of lines) {
    // Ví dụ: Câu 1: Nội dung câu hỏi
    // Hỗ trợ cả "Câu hỏi 1:" và "1."
    const questionMatch = line.match(
      /^(?:Câu\s*(?:hỏi\s*)?\d+\s*[:.)-]?|\d+\s*[.)])\s*(.*)$/i
    );

    if (questionMatch) {
      saveQuestion();

      current = {
        question: questionMatch[1].trim(),
        answers: {},
        correctLabel: null,
      };

      continue;
    }

    // Ví dụ: Đáp án: B, Đáp án đúng: B
    // Hoặc: Đáp án đúng là B
    const correctMatch = line.match(
      /^(?:Đáp\s*án(?:\s*đúng)?|Đáp\s*án\s*chính\s*xác)\s*(?::|[-–]|\s+là\s+)?\s*([A-F])(?:\s*[.)])?\s*$/i
    );

    if (correctMatch && current) {
      current.correctLabel = correctMatch[1].toUpperCase();
      continue;
    }

    // Hỗ trợ: A. Nội dung, A) Nội dung, A: Nội dung
    const optionMatch = line.match(
      /^([A-F])\s*[.)：:]\s*(.+)$/i
    );

    if (optionMatch && current) {
      const label = optionMatch[1].toUpperCase();
      current.answers[label] = optionMatch[2].trim();
      continue;
    }

    // Nếu câu hỏi bị xuống dòng, ghép phần chữ vào câu hiện tại.
    if (current && !current.correctLabel) {
      if (Object.keys(current.answers).length === 0) {
        current.question += ` ${line}`;
      } else {
        const lastLabel = Object.keys(current.answers).pop();
        current.answers[lastLabel] += ` ${line}`;
      }
    }
  }

  saveQuestion();

  if (questions.length === 0) {
    throw new Error(
      "Không nhận diện được câu hỏi. Hãy kiểm tra định dạng Câu 1:, A., B., C., D. và Đáp án: B."
    );
  }

  return shuffleArray(questions);
}

async function parseDocxBuffer(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim();

  if (!text) {
    throw new Error("File Word không có nội dung văn bản đọc được.");
  }

  return parseQuizText(text);
}

module.exports = {
  parseQuizText,
  parseDocxBuffer,
  shuffleArray,
};
