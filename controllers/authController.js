
const supabase = require("../supabase");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// =====================================================
// CREATE ACCESS TOKEN
// =====================================================

const createAccessToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("Chưa cấu hình JWT_SECRET");
  }

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

// =====================================================
// REGISTER
// =====================================================

const register = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Validate input
    if (!username || !password || !role) {
      return res.status(400).json({
        message: "Username, password và role không được để trống",
      });
    }

    // Normalize username
    const cleanUsername = String(username).trim().toLowerCase();

    // Normalize role
    const cleanRole = String(role).trim().toUpperCase();

    // Validate role
    if (!["USER", "ADMIN"].includes(cleanRole)) {
      return res.status(400).json({
        message: "Role không hợp lệ. Chỉ nhận USER hoặc ADMIN",
      });
    }

    // Validate username
    if (cleanUsername.length < 3) {
      return res.status(400).json({
        message: "Username phải có ít nhất 3 ký tự",
      });
    }

    // Validate password
    if (String(password).length < 3) {
      return res.status(400).json({
        message: "Password phải có ít nhất 3 ký tự",
      });
    }

    console.log("=================================");
    console.log("REGISTER REQUEST");
    console.log("Username:", cleanUsername);
    console.log("Role:", cleanRole);
    console.log("=================================");

    // Check existing username
    const {
      data: existingUser,
      error: checkError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (checkError) {
      console.error("CHECK USER ERROR:", checkError);

      return res.status(500).json({
        message: "Không thể kiểm tra username",
        error: checkError.message,
      });
    }

    if (existingUser) {
      return res.status(409).json({
        message: "Username đã tồn tại",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(
      String(password),
      10
    );

    // Insert user
    const {
      data,
      error,
    } = await supabase
      .from("users")
      .insert({
        username: cleanUsername,
        password: hashedPassword,
        role: cleanRole,
      })
      .select("id, username, created_at, role")
      .single();

    if (error) {
      console.error("INSERT USER ERROR:", error);

      return res.status(400).json({
        message: "Đăng ký thất bại",
        error: error.message,
      });
    }

    console.log("REGISTER SUCCESS:", {
      id: data.id,
      username: data.username,
      role: data.role,
    });

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data,
    });
  } catch (error) {
    console.error("REGISTER SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// LOGIN
// =====================================================

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống",
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();

    console.log("=================================");
    console.log("LOGIN REQUEST");
    console.log("Username:", cleanUsername);
    console.log("Password received:", !!password);
    console.log("=================================");

    // Find user
    const {
      data: user,
      error,
    } = await supabase
      .from("users")
      .select("id, username, password, created_at, role")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);

      return res.status(500).json({
        message: "Không thể kiểm tra tài khoản",
        error: error.message,
      });
    }

    if (!user) {
      return res.status(401).json({
        message: "Username hoặc password không đúng",
      });
    }

    // Check bcrypt hash
    const isBcryptHash =
      typeof user.password === "string" &&
      (
        user.password.startsWith("$2a$") ||
        user.password.startsWith("$2b$") ||
        user.password.startsWith("$2y$")
      );

    if (!isBcryptHash) {
      return res.status(500).json({
        message: "Password trong database không đúng định dạng bcrypt",
      });
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(
      String(password),
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Username hoặc password không đúng",
      });
    }

    // Remove password from response
    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      role: user.role,
    };

    // Create JWT
    const token = createAccessToken(userResponse);

    console.log("LOGIN SUCCESS:", {
      id: userResponse.id,
      username: userResponse.username,
      role: userResponse.role,
      tokenCreated: Boolean(token),
    });

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: userResponse,
      token,
    });
  } catch (error) {
    console.error("LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// QR LOGIN
// =====================================================

const qrLogin = async (req, res) => {
  try {
    const { qr_code } = req.body;

    if (!qr_code) {
      return res.status(400).json({
        message: "Mã QR không được để trống",
      });
    }

    const cleanQrCode = String(qr_code).trim();

    console.log("=================================");
    console.log("QR LOGIN REQUEST");
    console.log("=================================");

    // Find user by QR code
    const {
      data: user,
      error,
    } = await supabase
      .from("users")
      .select("id, username, created_at, qr_code, role")
      .eq("qr_code", cleanQrCode)
      .maybeSingle();

    if (error) {
      console.error("SUPABASE QR LOGIN ERROR:", error);

      return res.status(500).json({
        message: "Không thể kiểm tra mã QR",
        error: error.message,
      });
    }

    if (!user) {
      return res.status(401).json({
        message: "Mã QR không hợp lệ",
      });
    }

    // Remove QR code from response
    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      role: user.role,
    };

    // Create JWT
    const token = createAccessToken(userResponse);

    console.log("QR LOGIN SUCCESS:", {
      id: userResponse.id,
      username: userResponse.username,
      role: userResponse.role,
      tokenCreated: Boolean(token),
    });

    return res.status(200).json({
      message: "Đăng nhập bằng QR thành công",
      user: userResponse,
      token,
    });
  } catch (error) {
    console.error("QR LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  register,
  login,
  qrLogin,
};
