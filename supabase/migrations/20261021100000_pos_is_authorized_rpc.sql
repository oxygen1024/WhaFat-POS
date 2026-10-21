-- Lets the app tell "not on the POS allow-list" apart from "no orders yet".
-- Applied to project crbhacmnjtzokvzqwkex on 2026-10-21 via SQL (not listed in schema_migrations).
-- RLS returns zero rows to unauthorized users without an error, which hid the problem.
create or replace function public.pos_is_authorized()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select pos_private.is_authorized() $$;

revoke execute on function public.pos_is_authorized() from public, anon;
grant execute on function public.pos_is_authorized() to authenticated;
