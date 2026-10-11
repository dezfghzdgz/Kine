-- ============================================================================
-- Vysílání z appky (Kine Clipper / Kine do PC): appka Kine sama hlásí, že
-- vysílá (každých ~15 s), takže se vysílání ukáže jako živé hned - ne až
-- když ho najde Cloudflare.
--
-- Spusť v Supabase -> SQL Editor. Dá se pustit i víckrát. Bez ní všechno
-- funguje po staru (stav živě jen podle Cloudflare).
-- ============================================================================
alter table live_streams add column if not exists app_ping_at timestamptz;
