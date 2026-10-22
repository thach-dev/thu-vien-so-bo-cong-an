
const supabase = require("../config/supabase");

async function createQuiz(ownerId, title, questions) {
  if (!ownerId) throw new Error("Thiếu tài khoản người tạo");
  if (!title?.trim()) throw new Error("Vui lòng nhập tên bộ câu hỏi");
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Bộ câu hỏi phải có ít nhất một câu");
  }

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .insert({ owner_id: ownerId, title: title.trim() })
    .select("id, title, created_at")
    .single();

  if (error) throw error;

  const rows = questions.map((q, index) => {
    if (
      !q.question_text?.trim() ||
      !Array.isArray(q.answers) ||
      q.answers.length !== 4 ||
      !Number.isInteger(q.correct_answer) ||
      q.correct_answer < 0 ||
      q.correct_answer > 3
    ) {
      throw new Error(`Câu hỏi ${index + 1} không hợp lệ`);
    }

    return {
      game_id: quiz.id,
      question_text: q.question_text.trim(),
      answers: q.answers,
      correct_answer: q.correct_answer,
      time_limit: Math.max(5, Math.min(120, Number(q.time_limit) || 20)),
      points: Math.max(0, Number(q.points) || 1000),
      question_order: index + 1,
    };
  });

  const { error: questionError } = await supabase
    .from("quiz_questions")
    .insert(rows);

  if (questionError) {
    // Tránh để lại bộ câu hỏi rỗng nếu lưu câu hỏi thất bại.
    await supabase.from("quiz_games").delete().eq("id", quiz.id);
    throw questionError;
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
    .order("question_order");

  if (questionError) throw questionError;

  return { ...quiz, questions };
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
    .select("id, question_text, answers, time_limit, points, question_order")
    .eq("game_id", quizId)
    .order("question_order");

  if (questionError) throw questionError;

  // Không trả correct_answer cho người chơi trước khi chốt câu.
  return { ...quiz, questions };
}

module.exports = {
  createQuiz,
  getQuizForHost,
  getQuizForPlayer,
};
