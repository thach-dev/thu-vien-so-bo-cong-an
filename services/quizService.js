
const supabase = require("../config/supabase");

function validateQuizInput(ownerId, title, questions) {
  if (!ownerId) throw new Error("Thiếu tài khoản người tạo");
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
  });
}

async function createQuiz(ownerId, title, questions) {
  validateQuizInput(ownerId, title, questions);

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .insert({
      owner_id: ownerId,
      title: title.trim(),
    })
    .select("id, title, created_at")
    .single();

  if (error) {
    console.error("INSERT quiz_games:", error);
    throw new Error(`Không thể lưu bộ Quiz: ${error.message}`);
  }

  const rows = questions.map((q, index) => ({
    game_id: quiz.id,
    question_text: q.question_text,
    answers: q.answers,
    correct_answer: q.correct_answer,
    time_limit: q.time_limit || 20,
    points: q.points || 1000,
    question_order: index + 1,
  }));

  const { error: questionError } = await supabase
    .from("quiz_questions")
    .insert(rows);

  if (questionError) {
    console.error("INSERT quiz_questions:", questionError);

    // Cố gắng dọn bộ Quiz vừa tạo nếu lưu câu hỏi thất bại.
    const { error: cleanupError } = await supabase
      .from("quiz_games")
      .delete()
      .eq("id", quiz.id);

    if (cleanupError) {
      console.error("QUIZ CLEANUP ERROR:", cleanupError.message);
    }

    throw new Error(
      `Không lưu được danh sách câu hỏi: ${questionError.message}`
    );
  }

  return quiz;
}

async function getQuizForHost(quizId, ownerId) {
  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .select("id, title, created_at")
    .eq("id", quizId)
    .eq("owner_id", ownerId)
    .single();

  if (error) throw error;

  const { data: questions, error: questionError } = await supabase
    .from("quiz_questions")
    .select("*")
    .eq("game_id", quizId)
    .order("question_order", { ascending: true });

  if (questionError) throw questionError;

  return { ...quiz, questions: questions || [] };
}

async function getQuizForPlayer(quizId) {
  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .select("id, title")
    .eq("id", quizId)
    .single();

  if (error) throw error;

  const { data: questions, error: questionError } = await supabase
    .from("quiz_questions")
    .select(
      "id, question_text, answers, time_limit, points, question_order"
    )
    .eq("game_id", quizId)
    .order("question_order", { ascending: true });

  if (questionError) throw questionError;

  return { ...quiz, questions: questions || [] };
}

module.exports = {
  createQuiz,
  getQuizForHost,
  getQuizForPlayer,
};
