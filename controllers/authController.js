const supabase = require("../supabase");

// ==================================================
// REGISTER
// ==================================================
const register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email và password không được để trống" });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data.user,
      session: data.session
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ==================================================
// LOGIN
// ==================================================
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email và password không được để trống" });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ message: "Email hoặc mật khẩu không chính xác" });
    }

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: data.user,
      session: data.session // Chứa access_token
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = { register, login };