const express = require("express");
const router = express.Router();
const requireAuth = require("../middlewares/authMiddleware");

// Gắn middleware requireAuth vào route cần RLS
router.get("/profile", requireAuth, async (req, res) => {
  // req.supabase đã chứa token của user, câu lệnh này sẽ chạy đúng theo RLS policy
  const { data, error } = await req.supabase.from("profiles").select("*");
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ data });
});

module.exports = router;