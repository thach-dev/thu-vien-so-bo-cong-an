const supabase = require("../supabase");
const bcrypt = require("bcryptjs");

// ==================================================
// REGISTER
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

    const cleanUsername = username.trim().toLowerCase();

    // Kiểm tra username
    if (cleanUsername.length < 3) {
      return res.status(400).json({
        message: "Username phải có ít nhất 3 ký tự"
      });
    }

    // Kiểm tra password
    if (password.length < 3) {
      return res.status(400).json({
        message: "Password phải có ít nhất 3 ký tự"
      });
    }

    console.log("REGISTER:", {
      username: cleanUsername
    });

    // Kiểm tra username đã tồn tại chưa
    const { data: existingUser, error: checkError } = await supabase
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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tạo user
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          username: cleanUsername,
          password: hashedPassword,
          role: "user"
        }
      ])
      .select("id, username, role, created_at")
      .single();

    if (error) {
      console.error("SUPABASE REGISTER ERROR:", error);

      return res.status(400).json({
        message: "Đăng ký thất bại",
        error: error.message
      });
    }

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data
    });

  } catch (error) {
    console.error("REGISTER SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message || null
    });
  }
};


// ==================================================
// LOGIN
// ==================================================
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Kiểm tra dữ liệu
    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }

    const cleanUsername = username.trim().toLowerCase();

    console.log("LOGIN:", {
      username: cleanUsername
    });

    // Tìm user theo username
    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, password, role, created_at")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);

      return res.status(500).json({
        message: "Không thể kiểm tra tài khoản",
        error: error.message
      });
    }

    // Không tìm thấy username
    if (!user) {
      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // Kiểm tra password
    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // Không trả password về frontend
    const userResponse = {
      id: user.id,
      username: user.username,
      role: user.role,
      created_at: user.created_at
    };

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: userResponse
    });

  } catch (error) {
    console.error("LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message || null
    });
  }
};


module.exports = {
  register,
  login
};