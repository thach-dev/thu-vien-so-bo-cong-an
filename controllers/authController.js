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

    // Kiểm tra username đã tồn tại chưa
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (checkError) {
      console.error(checkError);

      return res.status(500).json({
        message: "Lỗi kiểm tra tài khoản"
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
          username: username,
          password: hashedPassword
        }
      ])
      .select("id, username, created_at")
      .single();

    if (error) {
      console.error(error);

      return res.status(500).json({
        message: "Không thể tạo tài khoản"
      });
    }

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error"
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

    // Tìm user
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      console.error(error);

      return res.status(500).json({
        message: "Lỗi database"
      });
    }

    if (!user) {
      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // So sánh password
    const passwordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordCorrect) {
      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // Không trả password về frontend
    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error"
    });
  }
};

module.exports = {
  register,
  login
};