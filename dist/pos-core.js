/** Pure, integer-cent arithmetic shared by the interface and its tests. */
export const MAX_MONEY_CENTS = 999999999;
export const PAYMENT_METHODS = ['cash', 'fps', 'payme', 'card', 'octopus'];
export function parseMoney(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimals = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_MONEY_CENTS ? cents : null;
}
function validateItems(items) {
  if (!Array.isArray(items)) throw new Error('商品資料不正確。');
  for (const item of items) {
    if (item?.priceReviewReason) throw new Error('商品價格需要確認。');
    if (!item || !Number.isSafeInteger(item.priceCents) || item.priceCents <= 0 || item.priceCents > MAX_MONEY_CENTS) throw new Error('商品價格不正確。');
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw new Error('商品數量須為 1 至 999。');
  }
}
export function calculateTotals(items, discount = { type: 'fixed', value: 0 }) {
  validateItems(items);
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  if (!Number.isSafeInteger(subtotalCents)) throw new Error('訂單金額超出範圍。');
  if (!discount || !['fixed', 'percent'].includes(discount.type) || !Number.isFinite(discount.value) || discount.value < 0) throw new Error('折扣不正確。');
  if (discount.type === 'fixed' && !Number.isSafeInteger(discount.value)) throw new Error('折扣金額須精確至仙。');
  if (discount.type === 'percent' && discount.value > 100) throw new Error('折扣百分比須為 0 至 100。');
  const discountCents = Math.min(subtotalCents, discount.type === 'fixed' ? discount.value : Math.round(subtotalCents * discount.value / 100));
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents, itemCount: items.reduce((sum, item) => sum + item.quantity, 0) };
}
export const LIMITS = { name: 60, phone: 30, note: 300, reason: 200 };
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export function sanitizeCustomer(input) {
  return { name: clean(input?.name, LIMITS.name).replace(/\s+/g, ' '), phone: clean(input?.phone, LIMITS.phone).replace(/\s+/g, ' ') };
}
export const sanitizeNote = value => clean(value, LIMITS.note);
export function makeSale({ items, discount = { type: 'fixed', value: 0 }, paymentMethod, tenderedCents, confirmed = false, createdAt = new Date().toISOString(), id, customer, note }) {
  if (!Array.isArray(items) || !items.length) throw new Error('請先加入商品。');
  const totals = calculateTotals(items, discount);
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error('請選擇付款方式。');
  if (paymentMethod === 'cash' && (!Number.isSafeInteger(tenderedCents) || tenderedCents < totals.totalCents || tenderedCents > MAX_MONEY_CENTS)) throw new Error('實收現金不可少於應付金額。');
  if (paymentMethod !== 'cash' && confirmed !== true) throw new Error('請先確認已在外部完成收款。');
  if (typeof id !== 'string' || !id.trim()) throw new Error('訂單編號不正確。');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('訂單日期不正確。');
  const sale = { id, createdAt, currency: 'HKD', test: true, localOnly: true, items: items.map(item => ({ ...item })), discount: { ...discount }, ...totals, paymentMethod, tenderedCents: paymentMethod === 'cash' ? tenderedCents : totals.totalCents, changeCents: paymentMethod === 'cash' ? tenderedCents - totals.totalCents : 0 };
  const contact = sanitizeCustomer(customer), memo = sanitizeNote(note);
  if (contact.name || contact.phone) sale.customer = contact;
  if (memo) sale.note = memo;
  return sale;
}
export const VOID_TYPES = ['void', 'refund'];
export const orderStatus = order => order?.status === 'voided' || order?.status === 'refunded' ? order.status : 'completed';
export function voidSale(order, { type, reason, at = new Date().toISOString() } = {}) {
  if (!order || typeof order !== 'object') throw new Error('訂單資料不正確。');
  if (orderStatus(order) !== 'completed') throw new Error('這張訂單已經作廢或退款。');
  if (!VOID_TYPES.includes(type)) throw new Error('請選擇作廢或退款。');
  const text = clean(reason, LIMITS.reason);
  if (!text) throw new Error('請填寫原因。');
  if (!Number.isFinite(Date.parse(at))) throw new Error('作廢日期不正確。');
  return { ...order, status: type === 'void' ? 'voided' : 'refunded', voidedAt: at, voidReason: text };
}
export function validateVoidFields(order) {
  if (order.status === undefined) {
    if ('voidedAt' in order || 'voidReason' in order) throw new Error('Invalid void fields');
    return;
  }
  if (!['voided', 'refunded'].includes(order.status) || !Number.isFinite(Date.parse(order.voidedAt)) || typeof order.voidReason !== 'string' || !order.voidReason.trim()) throw new Error('Invalid void fields');
}
export function validateContactFields(order) {
  if (order.customer !== undefined && (!order.customer || typeof order.customer.name !== 'string' || typeof order.customer.phone !== 'string')) throw new Error('Invalid customer');
  if (order.note !== undefined && typeof order.note !== 'string') throw new Error('Invalid note');
}
const hkParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' });
export function hkDateKey(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const parts = Object.fromEntries(hkParts.formatToParts(time).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function shiftDateKey(key, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** Sales count on the day an order was made; voids and refunds count on the day they were processed. */
export function summarizeDay(orders, dateKey) {
  const methods = new Map(), items = new Map();
  const method = key => { if (!methods.has(key)) methods.set(key, { method: key, count: 0, salesCents: 0, voidCount: 0, voidCents: 0, netCents: 0 }); return methods.get(key); };
  const day = { date: dateKey, orderCount: 0, salesCents: 0, discountCents: 0, voidCount: 0, voidCents: 0, netCents: 0, methods: [], items: [], voids: [] };
  for (const order of orders) {
    const status = orderStatus(order);
    if (hkDateKey(order.createdAt) === dateKey) {
      day.orderCount++; day.salesCents += order.totalCents; day.discountCents += order.discountCents;
      const entry = method(order.paymentMethod); entry.count++; entry.salesCents += order.totalCents;
      if (status === 'completed') for (const item of order.items) {
        const key = String(item.variantId), row = items.get(key) || { title: item.title, variantTitle: item.variantTitle, sku: item.sku || '', quantity: 0, amountCents: 0 };
        row.quantity += item.quantity; row.amountCents += item.priceCents * item.quantity; items.set(key, row);
      }
    }
    if (status !== 'completed' && hkDateKey(order.voidedAt) === dateKey) {
      day.voidCount++; day.voidCents += order.totalCents;
      const entry = method(order.paymentMethod); entry.voidCount++; entry.voidCents += order.totalCents;
      day.voids.push({ id: order.id, status, reason: order.voidReason, totalCents: order.totalCents, paymentMethod: order.paymentMethod, createdAt: order.createdAt, voidedAt: order.voidedAt });
    }
  }
  day.netCents = day.salesCents - day.voidCents;
  day.methods = [...methods.values()].map(entry => ({ ...entry, netCents: entry.salesCents - entry.voidCents })).sort((a, b) => PAYMENT_METHODS.indexOf(a.method) - PAYMENT_METHODS.indexOf(b.method));
  day.items = [...items.values()].sort((a, b) => b.quantity - a.quantity || b.amountCents - a.amountCents || a.title.localeCompare(b.title, 'zh-Hant'));
  return day;
}
export const searchTokens = text => String(text ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
export const matchesTokens = (haystack, tokens) => tokens.every(token => haystack.includes(token));
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
