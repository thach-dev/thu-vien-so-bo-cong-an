const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.MY_SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Thiếu biến môi trường SUPABASE_URL hoặc MY_SUPABASE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = supabase;