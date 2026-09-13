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
    const internalEmail = `${cleanUsername}${DOMAIN_SUFFIX}`;

    console.log("REGISTER:", {
      username: cleanUsername,
      internalEmail
    });

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
      console.error("SUPABASE REGISTER ERROR:", error);

      return res.status(400).json({
        message: "Supabase Register Error",
        code: error.code || null,
        error: error.message || null,
        details: error.details || null,
        hint: error.hint || null
      });
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
    console.error("REGISTER SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message || null,
      stack: process.env.NODE_ENV === "production"
        ? undefined
        : error.stack
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

    console.log("LOGIN:", {
      username: cleanUsername,
      internalEmail
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password
    });

    // Lỗi từ Supabase Auth
    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);

      return res.status(401).json({
        message: "Supabase Login Error",
        code: error.code || null,
        error: error.message || null,
        details: error.details || null,
        hint: error.hint || null
      });
    }

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: {
        id: data.user.id,
        username: cleanUsername
      },
      session: data.session
    });

  } catch (error) {
    console.error("LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message || null,
      stack: process.env.NODE_ENV === "production"
        ? undefined
        : error.stack
    });
  }
};

module.exports = {
  register,
  login
};