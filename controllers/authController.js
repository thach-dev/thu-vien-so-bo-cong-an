const supabase = require("../supabase");
const bcrypt = require("bcryptjs");


// =====================================================
// REGISTER
// =====================================================

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
    const cleanUsername = String(username)
      .trim()
      .toLowerCase();

    // Kiểm tra độ dài
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

    console.log("=================================");
    console.log("REGISTER REQUEST");
    console.log("Username:", cleanUsername);
    console.log("=================================");


    // =================================================
    // KIỂM TRA USERNAME ĐÃ TỒN TẠI CHƯA
    // =================================================

    const {
      data: existingUser,
      error: checkError
    } = await supabase
      .from("users")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (checkError) {
      console.error(
        "CHECK USER ERROR:",
        checkError
      );

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


    // =================================================
    // MÃ HÓA PASSWORD
    // =================================================

    const hashedPassword = await bcrypt.hash(
      String(password),
      10
    );

    console.log(
      "PASSWORD HASH CREATED:",
      !!hashedPassword
    );


    // =================================================
    // INSERT USER
    // =================================================

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
      console.error(
        "INSERT USER ERROR:",
        error
      );

      return res.status(400).json({
        message: "Đăng ký thất bại",
        error: error.message
      });
    }


    // =================================================
    // REGISTER SUCCESS
    // =================================================

    console.log(
      "REGISTER SUCCESS:",
      {
        id: data.id,
        username: data.username
      }
    );

    return res.status(201).json({
      message: "Đăng ký thành công",
      user: data
    });

  } catch (error) {

    console.error(
      "REGISTER SERVER ERROR:",
      error
    );

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};



// =====================================================
// LOGIN
// =====================================================

const login = async (req, res) => {
  try {

    const { username, password } = req.body;


    // =================================================
    // KIỂM TRA DỮ LIỆU
    // =================================================

    if (!username || !password) {
      return res.status(400).json({
        message: "Username và password không được để trống"
      });
    }


    // =================================================
    // CHUẨN HÓA USERNAME
    // =================================================

    const cleanUsername = String(username)
      .trim()
      .toLowerCase();


    console.log("=================================");
    console.log("LOGIN REQUEST");
    console.log("Username:", cleanUsername);
    console.log("Password received:", !!password);
    console.log(
      "Password length:",
      String(password).length
    );
    console.log("=================================");


    // =================================================
    // TÌM USER TRONG SUPABASE
    // =================================================

    const {
      data: user,
      error
    } = await supabase
      .from("users")
      .select(
        "id, username, password, created_at"
      )
      .eq("username", cleanUsername)
      .maybeSingle();


    // =================================================
    // SUPABASE ERROR
    // =================================================

    if (error) {

      console.error(
        "SUPABASE LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        message: "Không thể kiểm tra tài khoản",
        error: error.message
      });
    }


    // =================================================
    // KHÔNG TÌM THẤY USER
    // =================================================

    if (!user) {

      console.log("USER NOT FOUND");
      console.log(
        "Username searched:",
        cleanUsername
      );

      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }


    // =================================================
    // USER FOUND
    // =================================================

    console.log("USER FOUND");
    console.log("User ID:", user.id);
    console.log("Username DB:", user.username);
    console.log(
      "Has password:",
      !!user.password
    );


    // =================================================
    // KIỂM TRA PASSWORD CÓ PHẢI BCRYPT KHÔNG
    // =================================================

    const isBcryptHash =
      typeof user.password === "string" &&
      (
        user.password.startsWith("$2a$") ||
        user.password.startsWith("$2b$") ||
        user.password.startsWith("$2y$")
      );


    console.log(
      "Is bcrypt hash:",
      isBcryptHash
    );


    if (!isBcryptHash) {

      console.log(
        "PASSWORD TRONG DATABASE KHÔNG PHẢI BCRYPT"
      );

      return res.status(500).json({
        message:
          "Password trong database không đúng định dạng bcrypt"
      });
    }


    // =================================================
    // SO SÁNH PASSWORD
    // =================================================

    console.log(
      "Đang chạy bcrypt.compare..."
    );

    const passwordMatch =
      await bcrypt.compare(
        String(password),
        user.password
      );


    console.log(
      "Password match:",
      passwordMatch
    );


    // =================================================
    // PASSWORD SAI
    // =================================================

    if (!passwordMatch) {

      console.log(
        "PASSWORD SAI"
      );

      return res.status(401).json({
        message:
          "Username hoặc password không đúng"
      });
    }


    // =================================================
    // LOGIN SUCCESS
    // =================================================

    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at
    };


    console.log(
      "LOGIN SUCCESS:",
      userResponse
    );


    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: userResponse
    });


  } catch (error) {

    console.error(
      "LOGIN SERVER ERROR:",
      error
    );

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};



// =====================================================
// QR LOGIN
// =====================================================

const qrLogin = async (req, res) => {
  try {

    const { qr_code } = req.body;


    // =================================================
    // KIỂM TRA DỮ LIỆU
    // =================================================

    if (!qr_code) {
      return res.status(400).json({
        message: "Mã QR không được để trống"
      });
    }


    // =================================================
    // CHUẨN HÓA MÃ QR
    // =================================================

    const cleanQrCode = String(qr_code).trim();


    console.log("=================================");
    console.log("QR LOGIN REQUEST");
    console.log("QR Code:", cleanQrCode);
    console.log("=================================");


    // =================================================
    // TÌM USER THEO QR CODE
    // =================================================

    const {
      data: user,
      error
    } = await supabase
      .from("users")
      .select(
        "id, username, created_at, qr_code"
      )
      .eq("qr_code", cleanQrCode)
      .maybeSingle();


    // =================================================
    // SUPABASE ERROR
    // =================================================

    if (error) {

      console.error(
        "SUPABASE QR LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        message: "Không thể kiểm tra mã QR",
        error: error.message
      });
    }


    // =================================================
    // KHÔNG TÌM THẤY QR
    // =================================================

    if (!user) {

      console.log("QR CODE NOT FOUND");
      console.log(
        "QR Code searched:",
        cleanQrCode
      );

      return res.status(401).json({
        message: "Mã QR không hợp lệ"
      });
    }


    // =================================================
    // QR LOGIN SUCCESS
    // =================================================

    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at
    };


    console.log(
      "QR LOGIN SUCCESS:",
      userResponse
    );


    return res.status(200).json({
      message: "Đăng nhập bằng QR thành công",
      user: userResponse
    });


  } catch (error) {

    console.error(
      "QR LOGIN SERVER ERROR:",
      error
    );

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};



// =====================================================
// EXPORT
// =====================================================

module.exports = {
  register,
  login,
  qrLogin
};