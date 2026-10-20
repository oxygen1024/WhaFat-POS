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
export function makeSale({ items, discount = { type: 'fixed', value: 0 }, paymentMethod, tenderedCents, confirmed = false, createdAt = new Date().toISOString(), id }) {
  if (!Array.isArray(items) || !items.length) throw new Error('請先加入商品。');
  const totals = calculateTotals(items, discount);
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error('請選擇付款方式。');
  if (paymentMethod === 'cash' && (!Number.isSafeInteger(tenderedCents) || tenderedCents < totals.totalCents || tenderedCents > MAX_MONEY_CENTS)) throw new Error('實收現金不可少於應付金額。');
  if (paymentMethod !== 'cash' && confirmed !== true) throw new Error('請先確認已在外部完成收款。');
  if (typeof id !== 'string' || !id.trim()) throw new Error('訂單編號不正確。');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('訂單日期不正確。');
  return { id, createdAt, currency: 'HKD', test: true, localOnly: true, items: items.map(item => ({ ...item })), discount: { ...discount }, ...totals, paymentMethod, tenderedCents: paymentMethod === 'cash' ? tenderedCents : totals.totalCents, changeCents: paymentMethod === 'cash' ? tenderedCents - totals.totalCents : 0 };
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
