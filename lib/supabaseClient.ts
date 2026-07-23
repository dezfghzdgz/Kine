import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Tento klient se používá v komponentách, které běží v prohlížeči.
// Používá "anon key", což je bezpečné mít veřejně viditelné -
// skutečná ochrana dat se řeší přes Row Level Security v Supabase.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
