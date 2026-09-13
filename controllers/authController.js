
const supabase = require("../supabase");
const bcrypt = require("bcryptjs");

// ==================================================
// REGISTER
// POST /api/auth/register
// ==================================================
const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Kiểm tra dữ liệu
    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        message: "Username phải có ít nhất 3 ký tự"
      });
    }

    if (String(password).length < 3) {
      return res.status(400).json({
        message: "Password phải có ít nhất 3 ký tự"
      });
    }

    console.log("REGISTER:", cleanUsername);

    // --------------------------------------------------
    // Kiểm tra username đã tồn tại
    // --------------------------------------------------
    const {
      data: existingUser,
      error: checkError
    } = await supabase
      .from("users")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (checkError) {
      console.error("CHECK USER ERROR:", checkError);

      return res.status(500).json({
        message: "Không thể kiểm tra username",
        error: checkError.message
      });
    }

    if (existingUser) {
      return res.status(409).json({
        message: "Username đã tồn tại"
      });
    }

    // --------------------------------------------------
    // Hash password
    // --------------------------------------------------
    const hashedPassword = await bcrypt.hash(
      String(password),
      10
    );

    console.log("PASSWORD HASH CREATED:", !!hashedPassword);

    // --------------------------------------------------
    // Insert user
    // --------------------------------------------------
    const {
      data,
      error
    } = await supabase
      .from("users")
      .insert({
        username: cleanUsername,
        password: hashedPassword
      })
      .select("id, username, created_at")
      .single();

    if (error) {
      console.error("INSERT USER ERROR:", error);

      return res.status(400).json({
        message: "Đăng ký thất bại",
        error: error.message
      });
    }

    console.log("REGISTER SUCCESS:", {
      id: data.id,
      username: data.username
    });

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data
    });

  } catch (error) {
    console.error("REGISTER SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};


// ==================================================
// LOGIN
// POST /api/auth/login
// ==================================================
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // --------------------------------------------------
    // Kiểm tra dữ liệu
    // --------------------------------------------------
    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    const cleanUsername = String(username)
      .trim()
      .toLowerCase();

    console.log("=================================");
    console.log("LOGIN REQUEST");
    console.log("Username:", cleanUsername);
    console.log("Password received:", !!password);
    console.log("=================================");

    // --------------------------------------------------
    // Tìm username trong database
    // --------------------------------------------------
    const {
      data: user,
      error
    } = await supabase
      .from("users")
      .select("id, username, password, created_at")
      .eq("username", cleanUsername)
      .maybeSingle();

    // --------------------------------------------------
    // Lỗi Supabase
    // --------------------------------------------------
    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);

      return res.status(500).json({
        message: "Không thể kiểm tra tài khoản",
        error: error.message
      });
    }

    // --------------------------------------------------
    // Không tìm thấy username
    // --------------------------------------------------
    if (!user) {
      console.log("USER NOT FOUND:", cleanUsername);

      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // --------------------------------------------------
    // USER TỒN TẠI
    // --------------------------------------------------
    console.log("USER FOUND:", {
      id: user.id,
      username: user.username,
      hasPassword: !!user.password,
      passwordLength: user.password
        ? user.password.length
        : 0
    });

    // --------------------------------------------------
    // Kiểm tra password có phải bcrypt hash không
    // --------------------------------------------------
    const isBcryptHash =
      typeof user.password === "string" &&
      (
        user.password.startsWith("$2a$") ||
        user.password.startsWith("$2b$") ||
        user.password.startsWith("$2y$")
      );

    console.log("IS BCRYPT HASH:", isBcryptHash);

    if (!isBcryptHash) {
      console.log(
        "WARNING: Password trong database không phải bcrypt hash"
      );

      return res.status(500).json({
        message: "Password trong database không đúng định dạng bcrypt"
      });
    }

    // --------------------------------------------------
    // Kiểm tra password bằng bcrypt
    // --------------------------------------------------
    const passwordMatch = await bcrypt.compare(
      String(password),
      user.password
    );

    console.log("PASSWORD MATCH:", passwordMatch);

    // --------------------------------------------------
    // Password sai
    // --------------------------------------------------
    if (!passwordMatch) {
      console.log("PASSWORD INCORRECT");

      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // --------------------------------------------------
    // Không trả password về frontend
    // --------------------------------------------------
    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at
    };

    console.log("LOGIN SUCCESS:", userResponse);

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: userResponse
    });

  } catch (error) {
    console.error("LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};


// ==================================================
// EXPORT
// ==================================================
module.exports = {
  register,
  login
};
