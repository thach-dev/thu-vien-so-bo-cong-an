const bcrypt = require("bcryptjs");
const supabase = require("../supabase");

// ========================
// REGISTER
// ========================
const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Kiểm tra dữ liệu
    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    // Chuẩn hóa username
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      return res.status(400).json({
        message: "Username không được để trống"
      });
    }

    // Kiểm tra username đã tồn tại
    const {
      data: existingUser,
      error: checkError
    } = await supabase
      .from("users")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (checkError) {
      console.error("SUPABASE CHECK USER ERROR:", checkError);

      return res.status(500).json({
        message: "Lỗi kiểm tra tài khoản",
        error: checkError.message,
        code: checkError.code || null,
        details: checkError.details || null,
        hint: checkError.hint || null
      });
    }

    // Username đã tồn tại
    if (existingUser) {
      return res.status(409).json({
        message: "Username đã tồn tại"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tạo tài khoản
    const {
      data,
      error: insertError
    } = await supabase
      .from("users")
      .insert([
        {
          username: cleanUsername,
          password: hashedPassword
        }
      ])
      .select("id, username, created_at")
      .single();

    if (insertError) {
      console.error("SUPABASE REGISTER ERROR:", insertError);

      return res.status(500).json({
        message: "Không thể tạo tài khoản",
        error: insertError.message,
        code: insertError.code || null,
        details: insertError.details || null,
        hint: insertError.hint || null
      });
    }

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data
    });

  } catch (error) {
    console.error("REGISTER SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


// ========================
// LOGIN
// ========================
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Kiểm tra dữ liệu
    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    // Chuẩn hóa username
    const cleanUsername = username.trim();

    // Tìm tài khoản
    const {
      data: user,
      error: loginError
    } = await supabase
      .from("users")
      .select("id, username, password, created_at")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (loginError) {
      console.error("SUPABASE LOGIN ERROR:", loginError);

      return res.status(500).json({
        message: "Lỗi database",
        error: loginError.message,
        code: loginError.code || null,
        details: loginError.details || null,
        hint: loginError.hint || null
      });
    }

    // Không tìm thấy tài khoản
    if (!user) {
      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // Kiểm tra password
    const passwordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordCorrect) {
      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // Đăng nhập thành công
    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error("LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


// ========================
// EXPORT
// ========================
module.exports = {
  register,
  login
};