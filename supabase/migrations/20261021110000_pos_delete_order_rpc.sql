-- Permanently delete one order and its items, payment and void/refund rows.
-- Requested by the shop owner: any order may be deleted after a single confirmation.
-- Run in the Supabase SQL editor (the MCP tool needs a confirmation for DELETE statements).
create or replace function public.pos_delete_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select pos_private.is_authorized()) then raise exception 'POS access denied' using errcode='42501'; end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  delete from public.refunds where order_id = p_order_id;
  delete from public.payments where order_id = p_order_id;
  delete from public.order_items where order_id = p_order_id;
  delete from public.orders where id = p_order_id;
  return jsonb_build_object('id', p_order_id, 'deleted', true);
end; $$;

revoke execute on function public.pos_delete_order(text) from public, anon;
grant execute on function public.pos_delete_order(text) to authenticated;
notify pgrst, 'reload schema';
