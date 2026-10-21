-- Security and performance hardening from the Supabase advisors (2026-10-21).
-- Applied to project crbhacmnjtzokvzqwkex on 2026-10-21 statement by statement (the MCP
-- apply_migration call timed out), so it is not listed in supabase_migrations.schema_migrations.
-- Every statement is idempotent. Section 4 (drop policy) was run in the SQL editor.

-- 1. Private allow-list: RLS on with no policies. Only pos_private.is_authorized()
--    (SECURITY DEFINER, owned by postgres, the table owner) reads it, and owners bypass RLS.
alter table pos_private.authorized_users enable row level security;

-- 2. Catalog tables: anon/authenticated held every privilege (incl. TRUNCATE, which RLS
--    does not cover). The POS reads its catalog from catalog.json; keep read access only.
revoke all on table public.products, public.product_variants from anon, authenticated;
grant select on table public.products, public.product_variants to authenticated;

-- 3. Transaction tables: anon has no policy, so drop its unused SELECT grant too.
revoke all on table public.orders, public.order_items, public.payments, public.refunds from anon;

-- 4. Leftover direct-write policies. Writes go only through the RPCs (table grants are SELECT-only),
--    so these policies are dead and would become live if a grant were ever re-added.
drop policy if exists pos_insert_orders on public.orders;
drop policy if exists pos_update_orders on public.orders;
drop policy if exists pos_insert_items on public.order_items;
drop policy if exists pos_insert_payments on public.payments;
drop policy if exists pos_insert_refunds on public.refunds;

-- 5. Covering indexes for foreign keys (history, receipts and reports join on order_id).
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists refunds_order_id_idx on public.refunds (order_id);
create index if not exists product_variants_product_id_idx on public.product_variants (product_id);
-- History pages are ordered by created_at desc, id desc.
create index if not exists orders_created_at_id_idx on public.orders (created_at desc, id desc);
