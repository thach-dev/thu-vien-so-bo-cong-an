const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL + "/rest/v1",
  process.env.MY_SUPABASE_KEY
);

module.exports = supabase;