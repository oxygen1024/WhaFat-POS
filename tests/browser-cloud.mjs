// Cloud checkout flows against a mocked Supabase API (no real project is touched).
// Run after `npm start`: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs [CHROMIUM_PATH=...] node tests/browser-cloud.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.POS_TEST_URL || 'http://127.0.0.1:8765/';
const catalog = JSON.parse(await readFile(new URL('../dist/data/catalog.json', import.meta.url), 'utf8'));
const product = catalog.products.find(p => p.variants.some(v => v.available && v.priceCents > 0 && !v.priceReviewReason) && p.variants.length === 1);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, headless: true } : { headless: true });

function mockSupabase() {
  const db = { orders: [], failNextSaleAfterCommit: false, rejectRefresh: false, saveCalls: 0 };
  db.install = async context => context.route('https://crbhacmnjtzokvzqwkex.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token' && db.rejectRefresh) return json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
      return json({ access_token: 'token-' + Date.now(), refresh_token: 'refresh-' + Date.now(), expires_in: 3600 });
    }
    if (url.pathname === '/rest/v1/rpc/pos_is_authorized') {
      if (db.authorized === undefined) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      return json(db.authorized);
    }
    if (url.pathname === '/rest/v1/rpc/pos_delete_order') {
      const id = route.request().postDataJSON().p_order_id;
      db.orders = db.orders.filter(o => o.id !== id);
      return json({ id, deleted: true });
    }
    if (url.pathname === '/rest/v1/rpc/pos_save_sale') {
      db.saveCalls++;
      const sale = route.request().postDataJSON().p_sale;
      const existing = db.orders.find(o => o.id === sale.id);
      if (existing && JSON.stringify(existing.receipt_json) !== JSON.stringify(sale)) return json({ message: 'Order ID already exists with different contents' }, 400);
      if (!existing) db.orders.unshift({ id: sale.id, receipt_json: sale, status: 'completed', created_at: sale.createdAt });
      if (db.failNextSaleAfterCommit) { db.failNextSaleAfterCommit = false; return route.abort('connectionreset'); }
      return json({ id: sale.id, duplicate: !!existing });
    }
    if (url.pathname === '/rest/v1/orders') {
      const id = url.searchParams.get('id');
      return json(id ? db.orders.filter(o => 'eq.' + o.id === id) : db.orders);
    }
    return json({ message: 'unexpected ' + url.pathname }, 404);
  });
  return db;
}

async function freshPage(db) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block', timezoneId: 'Asia/Hong_Kong' });
  await db.install(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#cloud-login-form').waitFor();
  return { context, page, errors };
}
async function login(page) {
  await page.fill('#cloud-login-form [name=email]', 'shop@example.com');
  await page.fill('#cloud-login-form [name=password]', 'pw');
  await page.click('#cloud-login-form button');
  await page.locator('#cloud-login-cover').waitFor({ state: 'detached' });
}
async function addProduct(page) {
  await page.fill('#search', product.title);
  await page.locator(`[data-product="${product.id}"]`).click();
  await page.click('#add-product');
}
async function payCashExact(page) {
  await page.click('#checkout-button');
  await page.locator('[data-tender]').first().click();
  await page.click('#complete-sale');
}
const results = [];
async function step(name, work) {
  try { await work(); results.push(name); console.log('PASS', name); }
  catch (error) { console.error('FAIL', name, error.message); process.exitCode = 1; }
}

await step('Login shows cloud status as connected and a sale is saved once', async () => {
  const db = mockSupabase();
  const { context, page, errors } = await freshPage(db);
  assert.equal(await page.locator('#cloud-status').getAttribute('data-state'), 'login');
  await login(page);
  assert.equal(await page.locator('#cloud-status').getAttribute('data-state'), 'online');
  await addProduct(page);
  await payCashExact(page);
  await page.getByText('這張訂單完成了').waitFor();
  assert.equal(db.orders.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await step('Uncertain save followed by a cart change does not save the stale order as the new one', async () => {
  const db = mockSupabase();
  const { context, page } = await freshPage(db);
  await login(page);
  await addProduct(page);
  db.failNextSaleAfterCommit = true;
  await payCashExact(page);
  await page.locator('#payment-error').waitFor({ state: 'visible' });
  assert.equal(db.orders.length, 1, 'first attempt reached the server');
  const firstId = db.orders[0].id;
  await page.click('#modal-root [data-action="close-modal"]');
  await page.locator('[data-cart-plus]').first().click();   // cashier changes the cart
  await payCashExact(page);
  await page.locator('#payment-error').getByText(firstId).waitFor();
  assert.equal(db.orders.length, 1, 'no second order was created silently');
  // A further attempt is a new order with a fresh ID and the updated quantity.
  await page.click('#modal-root [data-action="close-modal"]');
  await payCashExact(page);
  await page.getByText('這張訂單完成了').waitFor();
  assert.equal(db.orders.length, 2);
  assert.notEqual(db.orders[0].id, firstId);
  assert.equal(db.orders[0].receipt_json.items[0].quantity, 2);
  await context.close();
});

await step('Unchanged retry after an uncertain save is recognised as the same order', async () => {
  const db = mockSupabase();
  const { context, page } = await freshPage(db);
  await login(page);
  await addProduct(page);
  db.failNextSaleAfterCommit = true;
  await payCashExact(page);
  await page.locator('#payment-error').waitFor({ state: 'visible' });
  await page.click('#complete-sale');
  await page.getByText('這張訂單完成了').waitFor();
  assert.equal(db.orders.length, 1);
  await context.close();
});

await step('A rejected refresh token brings back the login screen', async () => {
  const db = mockSupabase();
  const { context, page } = await freshPage(db);
  await login(page);
  db.rejectRefresh = true;
  await page.evaluate(() => {
    const key = 'whafat-pos-cloud-session-v1', s = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...s, expires_at: 1 }));
  });
  await page.reload();
  await page.locator('#cloud-login-form').waitFor();
  assert.equal(await page.locator('#cloud-status').getAttribute('data-state'), 'login');
  await context.close();
});

await step('Logout from the info panel returns to the login screen', async () => {
  const db = mockSupabase();
  const { context, page } = await freshPage(db);
  await login(page);
  await page.click('#info-button');
  await page.click('[data-action="logout"]');
  await page.locator('#cloud-login-form').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('whafat-pos-cloud-session-v1')), null);
  await context.close();
});

await step('An account that is not on the POS allow-list is told so instead of seeing an empty history', async () => {
  const db = mockSupabase();
  db.authorized = false;
  db.orders.push({ id: 'WF-X', receipt_json: {}, status: 'completed', created_at: new Date().toISOString() });
  const { context, page } = await freshPage(db);
  await page.fill('#cloud-login-form [name=email]', 'other@example.com');
  await page.fill('#cloud-login-form [name=password]', 'pw');
  await page.click('#cloud-login-form button');
  await page.locator('#cloud-login-error').getByText('未獲授權').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('whafat-pos-cloud-session-v1')), null);
  // A stored session for such an account shows the same message on reload.
  db.authorized = true;
  await login(page);
  db.authorized = false;
  await page.reload();
  await page.locator('#cloud-login-error').getByText('未獲授權').waitFor();
  await context.close();
});

await step('An authorized account passes the access check and logs in', async () => {
  const db = mockSupabase();
  db.authorized = true;
  const { context, page } = await freshPage(db);
  await login(page);
  assert.equal(await page.locator('#cloud-status').getAttribute('data-state'), 'online');
  await context.close();
});

await step('A saved order can be deleted from its receipt after confirming', async () => {
  const db = mockSupabase();
  const { context, page } = await freshPage(db);
  await login(page);
  await addProduct(page);
  await payCashExact(page);
  await page.getByText('這張訂單完成了').waitFor();
  const id = db.orders[0].id;
  await page.click('#modal-root [data-action="close-modal"]');
  await page.click('#history-button');
  await page.locator(`[data-order="${id}"]`).click();
  page.once('dialog', dialog => dialog.dismiss());   // cancelling keeps the order
  await page.locator(`[data-delete-order="${id}"]`).click();
  await page.waitForTimeout(300);
  assert.equal(db.orders.length, 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-delete-order="${id}"]`).click();
  await page.getByText('還未有交易記錄').waitFor();
  assert.equal(db.orders.length, 0);
  await context.close();
});

await browser.close();
console.log(`${results.length} cloud browser checks passed`);
