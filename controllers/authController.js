const login = async (req, res) => {
  try {
    const { username, password } = req.body;

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
    console.log("Password length:", String(password).length);
    console.log("=================================");

    // Tìm user
    const {
      data: user,
      error
    } = await supabase
      .from("users")
      .select("id, username, password, created_at")
      .eq("username", cleanUsername)
      .maybeSingle();

    // Lỗi Supabase
    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);

      return res.status(500).json({
        message: "Không thể kiểm tra tài khoản",
        error: error.message
      });
    }

    // Không tìm thấy user
    if (!user) {
      console.log("❌ USER NOT FOUND");
      console.log("Username searched:", cleanUsername);

      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    console.log("✅ USER FOUND");
    console.log("User ID:", user.id);
    console.log("Username DB:", user.username);
    console.log("Has password:", !!user.password);
    console.log("Password hash length:", user.password?.length);

    // Kiểm tra bcrypt
    const isBcryptHash =
      typeof user.password === "string" &&
      (
        user.password.startsWith("$2a$") ||
        user.password.startsWith("$2b$") ||
        user.password.startsWith("$2y$")
      );

    console.log("Is bcrypt hash:", isBcryptHash);

    if (!isBcryptHash) {
      console.log("❌ PASSWORD TRONG DATABASE KHÔNG PHẢI BCRYPT");

      return res.status(500).json({
        message: "Password trong database không đúng định dạng bcrypt"
      });
    }

    // So sánh password
    console.log("Đang chạy bcrypt.compare...");

    const passwordMatch = await bcrypt.compare(
      String(password),
      user.password
    );

    console.log("Password match:", passwordMatch);

    if (!passwordMatch) {
      console.log("❌ PASSWORD SAI");

      return res.status(401).json({
        message: "Username hoặc password không đúng"
      });
    }

    // Thành công
    const userResponse = {
      id: user.id,
      username: user.username,
      created_at: user.created_at
    };

    console.log("✅ LOGIN SUCCESS:", userResponse);

    return res.status(200).json({
      message: "Đăng nhập thành công",
      user: userResponse
    });

  } catch (error) {
    console.error("❌ LOGIN SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server Error",
      error: error.message
    });
  }
};