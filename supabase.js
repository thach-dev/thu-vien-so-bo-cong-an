const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("SUPABASE_URL chưa được cấu hình");
}

if (!supabaseKey) {
  console.error("SUPABASE_ANON_KEY chưa được cấu hình");
}

const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

module.exports = supabase;