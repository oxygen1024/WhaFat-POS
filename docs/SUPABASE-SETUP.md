# WhaFat POS — Supabase rollout

## Status

A dedicated Supabase project (`whafat`, ref `crbhacmnjtzokvzqwkex`) has the six POS tables with RLS enabled, an authorized shared account in `pos_private.authorized_users`, and an atomic `public.pos_save_sale(jsonb)` RPC. This branch is a staging branch; production `main` still uses browser-local trial orders. **Do not accept production sales until cloud checkout, refunds, reporting, and cross-device testing are complete.**

## Security

- Never commit a Supabase secret/service-role key or a shop password to GitHub Pages.
- Frontend may use only the project URL and publishable key, with Supabase Auth and RLS.
- `pos_save_sale` and `pos_void_sale` are SECURITY DEFINER (owner `postgres`, `search_path=''`) and check `pos_private.is_authorized()` first. The Supabase advisor flags them (lint 0029); this is intentional because signed-in users have SELECT-only table grants, so all writes must go through these validated RPCs. They validate totals and write order/items/payment atomically. Order IDs are idempotency keys; a reused ID with different contents is rejected.
- The authorized-user table is private; users must be explicitly added by the project administrator.

## Security review (2026-10-21)

| Finding | Risk | Action |
|---|---|---|
| `pos_private.authorized_users` has RLS off | Low: schema is not exposed to the API and only `postgres` has grants | Enable RLS (migration below) |
| `products` / `product_variants` grant ALL (incl. TRUNCATE) to `anon` and `authenticated` | Low today (tables empty, RLS blocks DML; TRUNCATE not reachable via PostgREST) | Reduce to SELECT for `authenticated` |
| Leftover INSERT/UPDATE policies on transaction tables | None today (no write grants) but live if a grant is re-added | Drop |
| Foreign keys without indexes (4) | Performance | Add indexes |
| Leaked password protection disabled | Medium for a shared shop password | Dashboard → Authentication → Providers → Email → enable "Prevent use of leaked passwords" (may need a paid plan); otherwise use a long random password |

`supabase/migrations/20261021090000_pos_security_hardening.sql` contains the SQL fixes. Apply it only after review.

## Done on this branch

- Shop login (email/password), persistent session, automatic token refresh, **logout** (info panel), and return to the login screen when the refresh token is rejected.
- `completeSale` writes via `pos_save_sale`. If a save is uncertain (network drop) and the cart is then changed, the app checks whether the earlier order ID already exists before saving anything new, so the stale order is never saved under the new cart.
- Cloud history (paginated), void/refund via `pos_void_sale`, cloud-based daily report and CSV.
- Top-bar cloud status: connected, offline, refresh failed, or not signed in. Orders refresh every 15 s and on focus or reconnect (polling, not Realtime).
- Tests: `npm test` (unit), `tests/browser-cloud.mjs` (cloud flows against a mocked Supabase API).

## Pending before release

1. Apply and verify the hardening migration; enable leaked-password protection.
2. Test on two real iPads: duplicate submits, reconnect, payment confirmation, refund race conditions.
3. Optional: replace 15 s polling with Supabase Realtime.
4. Validate catalog import and scheduled sync separately; don't overwrite transactions.
5. Update `tests/browser-smoke.mjs` / `browser-features.mjs` (written for the local-only version; they assume no login screen and local order storage).
6. Merge to `main` for GitHub Pages deployment.
