import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './cloud-config.js';
/** WhaFat POS production cloud API. */
const PROJECT_URL = SUPABASE_URL;
const STORAGE_KEY = 'whafat-pos-cloud-session-v1';
export class CloudError extends Error {
  constructor(message, { status = 0, authExpired = false } = {}) { super(message); this.status = status; this.authExpired = authExpired; }
}
export function makeCloudClient(publishableKey = SUPABASE_PUBLISHABLE_KEY) {
  if (!publishableKey || typeof publishableKey !== 'string') throw new CloudError('Supabase publishable key is required.');
  let session = null;
  let refreshing = null;
  try { session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Require login again */ }
  const headers = (accessToken, extra = {}) => ({
    apikey: publishableKey,
    ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
    ...extra
  });
  async function request(path, options = {}, token = session?.access_token) {
    const response = await fetch(PROJECT_URL + path, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new CloudError(data?.message || data?.error_description || data?.error || 'Supabase request failed (' + response.status + ')', { status: response.status, authExpired: response.status === 401 });
    return data;
  }
  function saveSession(value) {
    session = value ? { ...value, expires_at: value.expires_at || (Date.now()/1000 + (value.expires_in || 3600)) } : null;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
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
    if (!session.refresh_token) throw new CloudError('登入已過期，請重新登入。', { authExpired: true });
    // Share one refresh between concurrent callers; refresh tokens are single-use.
    refreshing ||= (async () => {
      try {
        const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        }, null);
        saveSession(refreshed);
        return refreshed.access_token;
      } catch (error) {
        // A rejected refresh token (4xx) needs a new login; network errors keep the session for a retry.
        if (error instanceof CloudError && error.status >= 400 && error.status < 500) {
          saveSession(null);
          throw new CloudError('登入已過期，請重新登入。', { status: error.status, authExpired: true });
        }
        throw error;
      } finally { refreshing = null; }
    })();
    return refreshing;
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
    const pageSize = 500;
    const all = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await request('/rest/v1/orders?select=id,receipt_json,status,created_at&order=created_at.desc,id.desc&limit=' + pageSize + '&offset=' + offset, {}, token);
      if (!Array.isArray(page)) throw new CloudError('雲端交易資料格式不正確，未有覆蓋現有記錄。');
      all.push(...page);
      if (page.length < pageSize) return all;
    }
  }
  async function orderById(id) {
    const token = await ensureSession();
    const rows = await request('/rest/v1/orders?select=id,receipt_json,status,created_at&id=eq.' + encodeURIComponent(id), {}, token);
    if (!Array.isArray(rows)) throw new CloudError('雲端交易資料格式不正確。');
    return rows[0] || null;
  }
  return {
    login, ensureSession, logout: () => saveSession(null),
    get isSignedIn() { return !!session?.access_token; },
    saveSale: sale => rpc('pos_save_sale', { p_sale: sale }),
    voidSale: (id, type, reason) => rpc('pos_void_sale', { p_order_id: id, p_type: type, p_reason: reason }),
    orders, orderById
  };
}
