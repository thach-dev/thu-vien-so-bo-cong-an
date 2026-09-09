const { createClient } = require("@supabase/supabase-js");

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    return res.status(401).json({ message: "Không có quyền truy cập (Thiếu Bearer Token)" });
  }

  // Khởi tạo Supabase client kèm token của chính user đó để kích hoạt RLS
  req.supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );

  next();
};

module.exports = requireAuth;