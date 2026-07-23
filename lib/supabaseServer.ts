import { createClient } from '@supabase/supabase-js';

// Tento klient se používá jen na serveru (v API routes), protože
// service role key obchází Row Level Security. NIKDY ho neposílej do prohlížeče.
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
