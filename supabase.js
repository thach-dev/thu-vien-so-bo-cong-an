const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL chưa được cấu hình");
}

if (!supabaseKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình");
}

const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

module.exports = supabase;