
const jwt = require("jsonwebtoken");

const requireAdmin = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        const token = authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const role = decoded.role;

        if (role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Bạn không có quyền quản trị Game Nối Từ.",
            });
        }

        req.user = decoded;

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Token không hợp lệ hoặc đã hết hạn.",
        });
    }
};

module.exports = requireAdmin;
