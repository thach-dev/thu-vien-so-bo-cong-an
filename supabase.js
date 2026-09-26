const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.MY_SUPABASE_KEY
);

module.exports = supabase;