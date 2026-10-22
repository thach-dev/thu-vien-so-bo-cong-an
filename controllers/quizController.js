async function createQuiz(ownerId, title, questions) {
  if (!ownerId || typeof ownerId !== "string") {
    throw new Error("Không tìm thấy ID người tạo Quiz.");
  }

  // Kiểm tra ownerId có tồn tại trong Supabase Auth
  const { data: owner, error: ownerError } =
    await supabase.auth.admin.getUserById(ownerId);

  if (ownerError || !owner?.user) {
    throw new Error(
      "Tài khoản tạo Quiz không tồn tại trong Supabase Auth. Vui lòng đăng nhập lại."
    );
  }

  const { data: quiz, error } = await supabase
    .from("quiz_games")
    .insert({
      owner_id: owner.user.id,
      title,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Không thể lưu bộ Quiz: ${error.message}`);
  }

  // Giữ phần lưu câu hỏi hiện có của bạn tại đây.
  // Không xóa logic insert vào quiz_questions.
  return quiz;
}