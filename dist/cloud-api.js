/** WhaFat POS cloud API — staging only, not yet loaded by production app. */
const PROJECT_URL = 'https://crbhacmnjtzokvzqwkex.supabase.co';
const STORAGE_KEY = 'whafat-pos-cloud-session-v1';
export class CloudError extends Error {}
export function makeCloudClient(publishableKey) {
  if (!publishableKey || typeof publishableKey !== 'string') throw new CloudError('Supabase publishable key is required.');
  let session = null;
  try { session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Require login again */ }
  const headers = (accessToken, extra = {}) => ({
    apikey: publishableKey,
    Authorization: 'Bearer ' + (accessToken || publishableKey),
    ...extra
  });
  async function request(path, options = {}, token = session?.access_token) {
    const response = await fetch(PROJECT_URL + path, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new CloudError(data?.message || data?.error_description || data?.error || 'Supabase request failed (' + response.status + ')');
    return data;
  }
  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  }
  async function login(email, password) {
    const result = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, null);
    if (!result.access_token) throw new CloudError('No session returned');
    saveSession(result);
    return result;
  }
  async function ensureSession() {
    if (!session?.access_token) throw new CloudError('請先登入店舖帳戶。');
    if (session.expires_at && session.expires_at * 1000 > Date.now() + 60000) return session.access_token;
    if (!session.refresh_token) throw new CloudError('登入已過期，請重新登入。');
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }, null);
    saveSession(refreshed);
    return refreshed.access_token;
  }
  async function rpc(name, args) {
    const token = await ensureSession();
    return request('/rest/v1/rpc/' + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }, token);
  }
  async function orders() {
    const token = await ensureSession();
    return request('/rest/v1/orders?select=id,receipt_json,status,created_at&order=created_at.desc&limit=1000', {}, token);
  }
  return {
    login, ensureSession, logout: () => saveSession(null),
    get isSignedIn() { return !!session?.access_token; },
    saveSale: sale => rpc('pos_save_sale', { p_sale: sale }),
    voidSale: (id, type, reason) => rpc('pos_void_sale', { p_order_id: id, p_type: type, p_reason: reason }),
    orders
  };
}
