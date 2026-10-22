
const jwt = require("jsonwebtoken");

const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        message: "Vui lòng đăng nhập để tiếp tục",
      });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("Thiếu JWT_SECRET trong biến môi trường");

      return res.status(500).json({
        message: "Backend chưa cấu hình JWT_SECRET",
      });
    }

    const decoded = jwt.verify(token, secret);

    if (!decoded.id) {
      return res.status(401).json({
        message: "Token không chứa thông tin người dùng hợp lệ",
      });
    }

    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        message: "Token không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
      });
    }

    console.error("AUTH MIDDLEWARE ERROR:", error.message);

    return res.status(500).json({
      message: "Lỗi xác thực người dùng",
    });
  }
};

module.exports = requireAuth;
