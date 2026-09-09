const supabase = require("../supabase");

// Đuôi domain giả lập để khớp với định dạng Supabase Auth
const DOMAIN_SUFFIX = "@app.local";

// ==================================================
// REGISTER
// ==================================================
const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    const cleanUsername = username.trim().toLowerCase();

    // Biến username thành định dạng email nội bộ cho Supabase Auth
    const internalEmail = `${cleanUsername}${DOMAIN_SUFFIX}`;

    const { data, error } = await supabase.auth.signUp({
      email: internalEmail,
      password,
      options: {
        data: {
          username: cleanUsername
        }
      }
    });

    if (error) {
      if (error.message.includes("already registered")) {
        return res.status(409).json({ message: "Username đã tồn tại" });
      }
      return res.status(400).json({ message: error.message });
    }

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: {
        id: data.user.id,
        username: cleanUsername,
        created_at: data.user.created_at
      },
      session: data.session
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

// ==================================================
// LOGIN
// ==================================================
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    const cleanUsername = username.trim().toLowerCase();
    const internalEmail = `${cleanUsername}${DOMAIN_SUFFIX}`;

    const { data, error } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password
    });

    if (error) {
      return res.status(401).json({
        message: "Username hoặc password không chính xác"
      });
    }

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: {
        id: data.user.id,
        username: cleanUsername
      },
      session: data.session // Chứa access_token để gọi các route có RLS
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

module.exports = {
  register,
  login
};