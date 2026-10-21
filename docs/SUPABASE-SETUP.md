# WhaFat POS — Supabase rollout

## Status

A dedicated Supabase project (`whafat`, ref `crbhacmnjtzokvzqwkex`) has the six POS tables with RLS enabled, an authorized shared account in `pos_private.authorized_users`, and an atomic `public.pos_save_sale(jsonb)` RPC. This branch is a staging branch; production `main` still uses browser-local trial orders. **Do not accept production sales until cloud checkout, refunds, reporting, and cross-device testing are complete.**

## Security

- Never commit a Supabase secret/service-role key or a shop password to GitHub Pages.
- Frontend may use only the project URL and publishable key, with Supabase Auth and RLS.
- `pos_save_sale` is SECURITY INVOKER, validates totals and writes order/items/payment atomically. Order IDs are idempotency keys; a reused ID with different contents is rejected.
- The authorized-user table is private; users must be explicitly added by the project administrator.
- RLS currently permits authorized reads and inserts needed by the RPC. Refunds require a separate validated atomic RPC.

## Pending before release

1. Build a shop-login interface (Supabase email/password, persistent session, logout) without exposing credentials.
2. Integrate `pos_save_sale` into `completeSale`; handle uncertain network outcomes by checking the order ID before retrying; never show success on local-only persistence.
3. Load orders from the cloud, subscribe to authorized Realtime changes, and provide clear online/offline status.
4. Implement atomic void/refund RPC and cloud reporting/CSV export.
5. Test two iPads, duplicate submits, reconnect, payment confirmation, and refund race conditions.
6. Validate catalog import and scheduled sync separately; don't overwrite transactions.
7. Review security advisors and run tests, then merge to `main` for GitHub Pages deployment.
