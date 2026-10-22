
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
      throw new Error(
        `Câu hỏi ${index + 1} phải có đúng 4 đáp án dạng văn bản`
      );
    }

    if (
      !Number.isInteger(q.correct_answer) ||
      q.correct_answer < 0 ||
      q.correct_answer > 3
    ) {
      throw new Error(
        `Đáp án đúng của câu ${index + 1} phải nằm trong khoảng 0–3`
      );
    }
  });
}

async function createQuiz(ownerId, title, questions) {
  validateQuizInput(ownerId, title, questions);

  // Tạo bộ câu hỏi.
  const { data: quiz, error: quizError } = await supabase
    .from("quiz_games")
    .insert({
      owner_id: ownerId,
      title: title.trim(),
    })
    .select("id, title, created_at")
    .single();

  if (quizError) {
    console.error("CREATE QUIZ ERROR:", {
      code: quizError.code,
      message: quizError.message,
      details: quizError.details,
      hint: quizError.hint,
    });

    throw new Error(
      `Không thể tạo bộ câu hỏi: ${quizError.message}`
    );
  }

  // Chuẩn hóa các câu hỏi.
  const rows = questions.map((q, index) => ({
    game_id: quiz.id,
    question_text: q.question_text.trim(),
    answers: q.answers.map((answer) => answer.trim()),
    correct_answer: q.correct_answer,
    time_limit: Math.max(
      5,
      Math.min(120, Number(q.time_limit) || 20)
    ),
    points: Math.max(0, Number(q.points) || 1000),
    question_order: index + 1,
  }));

  // Lưu câu hỏi vào bảng quiz_questions.
  const { error: questionError } = await supabase
    .from("quiz_questions")
    .insert(rows);

  if (questionError) {
    console.error("CREATE QUIZ QUESTIONS ERROR:", {
      code: questionError.code,
      message: questionError.message,
      details: questionError.details,
      hint: questionError.hint,
    });

    // Cố gắng xóa bộ câu hỏi vừa tạo nếu bước tiếp theo thất bại.
    const { error: cleanupError } = await supabase
      .from("quiz_games")
      .delete()
      .eq("id", quiz.id);

    if (cleanupError) {
      console.error("QUIZ CLEANUP ERROR:", cleanupError.message);
    }

    throw new Error(
      `Đã tạo bộ câu hỏi nhưng không lưu được danh sách câu hỏi: ${questionError.message}`
    );
  }

  return quiz;
}

async function getQuizForHost(quizId, ownerId) {
  if (!quizId || !ownerId) {
    throw new Error("Thiếu mã bộ câu hỏi hoặc tài khoản người tạo");
  }

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .select("id, title, created_at")
    .eq("id", quizId)
    .eq("owner_id", ownerId)
    .single();

  if (error) {
    console.error("GET HOST QUIZ ERROR:", error.message);
    throw new Error(`Không thể tải bộ câu hỏi: ${error.message}`);
  }

  const { data: questions, error: questionError } = await supabase
    .from("quiz_questions")
    .select("*")
    .eq("game_id", quizId)
    .order("question_order", { ascending: true });

  if (questionError) {
    console.error("GET HOST QUESTIONS ERROR:", questionError.message);
    throw new Error(
      `Không thể tải danh sách câu hỏi: ${questionError.message}`
    );
  }

  return {
    ...quiz,
    questions: questions || [],
  };
}

async function getQuizForPlayer(quizId) {
  if (!quizId) {
    throw new Error("Thiếu mã bộ câu hỏi");
  }

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .select("id, title")
    .eq("id", quizId)
    .single();

  if (error) {
    console.error("GET PLAYER QUIZ ERROR:", error.message);
    throw new Error(`Không thể tải bộ câu hỏi: ${error.message}`);
  }

  const { data: questions, error: questionError } = await supabase
    .from("quiz_questions")
    .select(
      "id, question_text, answers, time_limit, points, question_order"
    )
    .eq("game_id", quizId)
    .order("question_order", { ascending: true });

  if (questionError) {
    console.error("GET PLAYER QUESTIONS ERROR:", questionError.message);
    throw new Error(
      `Không thể tải danh sách câu hỏi: ${questionError.message}`
    );
  }

  // Không trả correct_answer cho người chơi.
  return {
    ...quiz,
    questions: questions || [],
  };
}

module.exports = {
  createQuiz,
  getQuizForHost,
  getQuizForPlayer,
};
