
const supabase = require("../supabase");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// =====================================================
// TẠO JWT TOKEN
// =====================================================

const createAccessToken = (user) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("Server chưa cấu hình JWT_SECRET");
  }

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    secret,
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

    if (!username || !password || !role) {
      return res.status(400).json({
        message: "Username, password và role không được để trống",
      });
    }

    const cleanUsername = String(username)
      .trim()
      .toLowerCase();

    const cleanRole = String(role)
      .trim()
      .toUpperCase();

    if (!["USER", "ADMIN"].includes(cleanRole)) {
      return res.status(400).json({
        message: "Role không hợp lệ. Chỉ nhận USER hoặc ADMIN",
      });
    }

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        message: "Username phải có ít nhất 3 ký tự",
      });
    }

    if (String(password).length < 3) {
      return res.status(400).json({
        message: "Password phải có ít nhất 3 ký tự",
      });
    }

    // Kiểm tra username đã tồn tại
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
      });
    }

    if (existingUser) {
      return res.status(409).json({
        message: "Username đã tồn tại",
      });
    }

    // Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(
      String(password),
      10
    );

    // Tạo tài khoản
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

    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống",
      });
    }

    const cleanUsername = String(username)
      .trim()
      .toLowerCase();

    // Tìm tài khoản
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
      });
    }

    if (!user) {
      return res.status(401).json({
        message: "Username hoặc password không đúng",
      });
    }

    // Kiểm tra định dạng bcrypt
    const isBcryptHash =
      typeof user.password === "string" &&
      /^\$2[aby]\$/.test(user.password);

    if (!isBcryptHash) {
      return res.status(500).json({
        message: "Password trong database không đúng định dạng bcrypt",
      });
    }

    // So sánh mật khẩu
    const passwordMatch = await bcrypt.compare(
      String(password),
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Username hoặc password không đúng",
      });
    }

    // Thông tin tài khoản trả về frontend
    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      role: user.role,
    };

    // Tạo JWT
    const token = createAccessToken(userResponse);

    console.log("LOGIN SUCCESS:", {
      id: userResponse.id,
      username: userResponse.username,
      role: userResponse.role,
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

    // Tìm tài khoản theo mã QR
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
      });
    }

    if (!user) {
      return res.status(401).json({
        message: "Mã QR không hợp lệ",
      });
    }

    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      role: user.role,
    };

    // Tạo JWT cho đăng nhập QR
    const token = createAccessToken(userResponse);

    console.log("QR LOGIN SUCCESS:", {
      id: userResponse.id,
      username: userResponse.username,
      role: userResponse.role,
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
