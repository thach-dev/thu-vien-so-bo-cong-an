
const supabase = require("../config/supabase");

function validateQuizInput(ownerId, title, questions) {
  if (!ownerId) {
    throw new Error("Thiếu tài khoản người tạo");
  }

  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Vui lòng nhập tên bộ câu hỏi");
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Bộ câu hỏi phải có ít nhất một câu");
  }

  questions.forEach((q, index) => {
    if (
      !q ||
      typeof q.question_text !== "string" ||
      !q.question_text.trim()
    ) {
      throw new Error(`Câu hỏi ${index + 1} không hợp lệ`);
    }

    if (
      !Array.isArray(q.answers) ||
      q.answers.length !== 4 ||
      q.answers.some(
        (answer) => typeof answer !== "string" || !answer.trim()
      )
    ) {
      throw new Error(`Câu ${index + 1} phải có đúng 4 đáp án`);
    }

    if (
      !Number.isInteger(q.correct_answer) ||
      q.correct_answer < 0 ||
      q.correct_answer > 3
    ) {
      throw new Error(`Đáp án đúng câu ${index + 1} không hợp lệ`);
    }

    const timeLimit = q.time_limit ?? 20;
    const points = q.points ?? 1000;

    if (
      !Number.isInteger(timeLimit) ||
      timeLimit < 5 ||
      timeLimit > 120
    ) {
      throw new Error(`Thời gian câu ${index + 1} phải từ 5 đến 120 giây`);
    }

    if (!Number.isInteger(points) || points < 0) {
      throw new Error(`Điểm câu ${index + 1} không hợp lệ`);
    }
  });
}

// Tạo quiz: toàn bộ câu hỏi nằm trong một record quiz_games
async function createQuiz(ownerId, title, questions) {
  validateQuizInput(ownerId, title, questions);

  const storedQuestions = questions.map((q, index) => ({
    id: q.id || null,
    question_text: q.question_text.trim(),
    answers: q.answers.map((answer) => answer.trim()),
    correct_answer: q.correct_answer,
    time_limit: q.time_limit ?? 20,
    points: q.points ?? 1000,
    question_order: index + 1,
  }));

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .insert({
      owner_id: ownerId,
      title: title.trim(),
      questions: storedQuestions,
    })
    .select("id, title, created_at, owner_id, questions")
    .single();

  if (error) {
    console.error("INSERT QUIZ ERROR:", error);
    throw new Error(`Không thể lưu bộ Quiz: ${error.message}`);
  }

  return quiz;
}

// Lấy quiz để tổ chức chơi, không bắt buộc phải là chủ sở hữu
async function getQuizForHost(quizId, ownerId) {
  if (!quizId) {
    throw new Error("Thiếu mã bài quiz.");
  }

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .select("id, title, created_at, owner_id, questions")
    .eq("id", quizId)
    .maybeSingle();

  if (error) {
    console.error("GET QUIZ ERROR:", error);
    throw new Error("Không thể lấy bài quiz.");
  }

  if (!quiz) {
    throw new Error("Không tìm thấy bài quiz.");
  }

  const questions = normalizeQuestions(quiz.questions);

  if (questions.length === 0) {
    throw new Error("Bài quiz chưa có câu hỏi.");
  }

  return {
    ...quiz,
    questions,
  };
}

// Lấy quiz cho người chơi
async function getQuizForPlayer(quizId) {
  if (!quizId) {
    throw new Error("Thiếu mã bài quiz.");
  }

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .select("id, title, questions")
    .eq("id", quizId)
    .maybeSingle();

  if (error) {
    console.error("GET QUIZ FOR PLAYER ERROR:", error);
    throw new Error("Không thể lấy bài quiz.");
  }

  if (!quiz) {
    throw new Error("Không tìm thấy bài quiz.");
  }

  const questions = normalizeQuestions(quiz.questions);

  if (questions.length === 0) {
    throw new Error("Bài quiz chưa có câu hỏi.");
  }

  // Không gửi đáp án đúng xuống client người chơi
  const playerQuestions = questions.map((q) => ({
    id: q.id,
    question_text: q.question_text,
    answers: q.answers,
    time_limit: q.time_limit,
    points: q.points,
    question_order: q.question_order,
  }));

  return {
    id: quiz.id,
    title: quiz.title,
    questions: playerQuestions,
  };
}

// Chuẩn hóa và sắp xếp câu hỏi theo thứ tự
function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions
    .map((q, index) => ({
      ...q,
      question_order: q.question_order ?? index + 1,
      time_limit: q.time_limit ?? 20,
      points: q.points ?? 1000,
    }))
    .sort((a, b) => a.question_order - b.question_order);
}

// Lấy danh sách quiz cho người dùng chọn
async function getQuizzesForUser() {
  const { data, error } = await supabase
    .from("quiz_games")
    .select("id, title, created_at, owner_id")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET QUIZZES ERROR:", error);
    throw new Error("Không thể tải danh sách bài quiz.");
  }

  return data || [];
}

module.exports = {
  createQuiz,
  getQuizForHost,
  getQuizForPlayer,
  getQuizzesForUser,
};
