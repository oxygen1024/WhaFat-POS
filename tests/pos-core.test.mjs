import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMoney, calculateTotals, makeSale, csvCell, sanitizeCustomer, sanitizeNote, voidSale, orderStatus, validateVoidFields, validateContactFields, hkDateKey, shiftDateKey, summarizeDay, searchTokens, matchesTokens } from '../dist/pos-core.js';

const catalog = JSON.parse(await readFile(new URL('../dist/data/catalog.json', import.meta.url), 'utf8'));
const item = (priceCents = 22600, quantity = 1) => ({
  variantId: 40971122311297, productId: 7077097472129,
  title: 'Philips 飛利浦Moire 天花板燈星紋閃爍17w / 20w 4000k',
  variantTitle: '17w', sku: null, priceCents, quantity, imageUrl: '',
});
const sale = (changes = {}) => makeSale({
  items: [item()], paymentMethod: 'cash', tenderedCents: 30000,
  id: 'QA-001', createdAt: '2026-10-20T10:00:00.000Z', ...changes,
});

test('Decimal cash input is converted to integer cents without rounding unknown precision', () => {
  for (const [input, expected] of [['226', 22600], ['226.0', 22600], ['0.29', 29], ['9999999.99', 999999999]]) {
    assert.equal(parseMoney(input), expected);
  }
  for (const invalid of ['', null, '-1', '1.234', '1e3', 'Infinity', '1,000', 'HK$10', '10000000']) {
    assert.equal(parseMoney(invalid), null, String(invalid));
  }
});

test('Two real website variants retain their distinct exact totals and 10% discount', () => {
  assert.deepEqual(calculateTotals([item(22600), { ...item(26200), variantId: 40971122344065, variantTitle: '20w' }], { type: 'percent', value: 10 }), {
    subtotalCents: 48800, discountCents: 4880, totalCents: 43920, itemCount: 2,
  });
});

test('Fractional dollars and rounding never create sub-cent amounts', () => {
  assert.deepEqual(calculateTotals([item(10, 3), item(20)], { type: 'percent', value: 15 }), {
    subtotalCents: 50, discountCents: 8, totalCents: 42, itemCount: 4,
  });
});

test('An overlarge fixed discount produces a zero total, never a negative sale', () => {
  const result = calculateTotals([item()], { type: 'fixed', value: 30000 });
  assert.equal(result.discountCents, 22600);
  assert.equal(result.totalCents, 0);
});

test('Invalid quantities, zero or malformed prices, and malformed discounts cannot be sold', () => {
  for (const quantity of [0, -1, 1.5, 1000, NaN, Infinity]) {
    assert.throws(() => calculateTotals([item(22600, quantity)]));
  }
  for (const price of [0, -1, 1.5, NaN, Infinity, 1000000000]) {
    assert.throws(() => calculateTotals([item(price)]));
  }
  for (const discount of [{ type: 'fixed', value: 1.5 }, { type: 'fixed', value: -1 }, { type: 'percent', value: 101 }, { type: 'percent', value: NaN }, { type: 'other', value: 1 }]) {
    assert.throws(() => calculateTotals([item()], discount));
  }
});

test('A positive website price explicitly flagged for review cannot be sold', () => {
  assert.throws(() => calculateTotals([{ ...item(), priceReviewReason: '需確認價格' }]));
  assert.throws(() => sale({ items: [{ ...item(), priceReviewReason: '需確認價格' }] }));
});

test('Every imported variant marked for a price review is blocked at checkout', () => {
  const flagged = catalog.products.flatMap(product => product.variants.filter(variant => variant.priceReviewReason));
  assert.ok(flagged.length > 0);
  for (const variant of flagged) {
    assert.throws(() => sale({ items: [{ ...item(variant.priceCents), variantId: variant.id, priceReviewReason: variant.priceReviewReason }] }), `Flagged variant ${variant.id}`);
  }
});

test('Cash sale records integer tender and exact change', () => {
  const order = sale({ items: [item(22600, 2)], tenderedCents: 50000, discount: { type: 'fixed', value: 200 } });
  assert.equal(order.totalCents, 45000);
  assert.equal(order.tenderedCents, 50000);
  assert.equal(order.changeCents, 5000);
  assert.equal(order.currency, 'HKD');
  assert.equal(order.test, true);
  assert.equal(order.localOnly, true);
});

test('Insufficient, fractional, or overflowing cash cannot complete checkout', () => {
  for (const tenderedCents of [22599, 22600.5, NaN, Infinity, 1000000000, undefined]) {
    assert.throws(() => sale({ tenderedCents }));
  }
});

test('External payment methods require explicit confirmation before recording a sale', () => {
  for (const paymentMethod of ['fps', 'payme', 'card', 'octopus']) {
    assert.throws(() => sale({ paymentMethod }));
    const order = sale({ paymentMethod, confirmed: true, tenderedCents: 99999 });
    assert.equal(order.tenderedCents, 22600);
    assert.equal(order.changeCents, 0);
  }
  assert.throws(() => sale({ paymentMethod: 'unrecognised', confirmed: true }));
});

test('Empty carts and invalid record identifiers or dates are rejected', () => {
  assert.throws(() => sale({ items: [] }));
  assert.throws(() => sale({ id: '' }));
  assert.throws(() => sale({ createdAt: 'not a date' }));
});

test('A saved sale is independent from subsequent cart and discount mutations', () => {
  const items = [item()];
  const discount = { type: 'fixed', value: 100 };
  const order = sale({ items, discount });
  items[0].quantity = 9;
  discount.value = 2000;
  assert.equal(order.items[0].quantity, 1);
  assert.equal(order.discount.value, 100);
  assert.equal(order.totalCents, 22500);
});

test('CSV export quotes text and neutralises spreadsheet formula prefixes', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('@SUM(1,2)'), '"\'@SUM(1,2)"');
  assert.equal(csvCell('普通商品'), '"普通商品"');
});

test('Customer details and notes are trimmed, bounded, optional, and kept off the sale when empty', () => {
  assert.deepEqual(sanitizeCustomer({ name: '  陳  先生 ', phone: ' 9123\t4567 ' }), { name: '陳 先生', phone: '9123 4567' });
  assert.equal(sanitizeCustomer({ name: 'x'.repeat(100) }).name.length, 60);
  assert.equal(sanitizeNote('x'.repeat(500)).length, 300);
  assert.equal(sanitizeNote('\u0000送貨\n樓下'), '送貨\n樓下');
  const plain = sale();
  assert.equal('customer' in plain, false);
  assert.equal('note' in plain, false);
  const withContact = sale({ customer: { name: '陳先生', phone: '91234567' }, note: '星期五送貨' });
  assert.deepEqual(withContact.customer, { name: '陳先生', phone: '91234567' });
  assert.equal(withContact.note, '星期五送貨');
  assert.equal('customer' in sale({ customer: { name: '  ', phone: '' } }), false);
});

test('Voiding or refunding keeps the original sale, needs a reason, and can only happen once', () => {
  const original = sale();
  assert.equal(orderStatus(original), 'completed');
  const voided = voidSale(original, { type: 'void', reason: ' 輸入錯誤 ', at: '2026-10-20T11:00:00.000Z' });
  assert.equal(voided.status, 'voided');
  assert.equal(voided.voidReason, '輸入錯誤');
  assert.equal(voided.totalCents, original.totalCents);
  assert.equal(original.status, undefined);
  assert.equal(voidSale(original, { type: 'refund', reason: '退貨' }).status, 'refunded');
  assert.throws(() => voidSale(voided, { type: 'refund', reason: '退貨' }), /已經作廢或退款/);
  assert.throws(() => voidSale(original, { type: 'other', reason: 'x' }));
  assert.throws(() => voidSale(original, { type: 'void', reason: '   ' }), /原因/);
  assert.throws(() => voidSale(original, { type: 'void', reason: 'x', at: 'not a date' }));
  assert.doesNotThrow(() => validateVoidFields(original));
  assert.doesNotThrow(() => validateVoidFields(voided));
  assert.throws(() => validateVoidFields({ ...original, status: 'voided' }));
  assert.throws(() => validateVoidFields({ ...original, status: 'paid', voidedAt: voided.voidedAt, voidReason: 'x' }));
  assert.throws(() => validateVoidFields({ ...original, voidReason: 'orphan' }));
});

test('Hong Kong date keys follow local midnight, not UTC', () => {
  assert.equal(hkDateKey('2026-10-20T15:59:59.000Z'), '2026-10-20');
  assert.equal(hkDateKey('2026-10-20T16:00:00.000Z'), '2026-10-21');
  assert.equal(hkDateKey('garbage'), '');
  assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDateKey('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateKey('bad', 1), '');
});

test('Daily summary counts sales on the order day and voids on the day they were processed', () => {
  const orders = [
    sale({ id: 'A', createdAt: '2026-10-20T02:00:00.000Z', tenderedCents: 30000 }),
    sale({ id: 'B', createdAt: '2026-10-20T03:00:00.000Z', items: [{ ...item(10000, 2), variantId: 1 }], discount: { type: 'fixed', value: 500 }, paymentMethod: 'fps', confirmed: true }),
    voidSale(sale({ id: 'C', createdAt: '2026-10-20T04:00:00.000Z', tenderedCents: 30000 }), { type: 'void', reason: '輸入錯誤', at: '2026-10-20T04:10:00.000Z' }),
    voidSale(sale({ id: 'D', createdAt: '2026-10-19T04:00:00.000Z', tenderedCents: 30000 }), { type: 'refund', reason: '退貨', at: '2026-10-20T05:00:00.000Z' }),
    sale({ id: 'E', createdAt: '2026-10-20T17:00:00.000Z', tenderedCents: 30000 }),
  ];
  const day = summarizeDay(orders, '2026-10-20');
  assert.equal(day.orderCount, 3);
  assert.equal(day.salesCents, 22600 + 19500 + 22600);
  assert.equal(day.discountCents, 500);
  assert.equal(day.voidCount, 2);
  assert.equal(day.voidCents, 22600 * 2);
  assert.equal(day.netCents, day.salesCents - day.voidCents);
  assert.deepEqual(day.methods.map(m => [m.method, m.count, m.salesCents, m.voidCount, m.voidCents, m.netCents]), [['cash', 2, 45200, 2, 45200, 0], ['fps', 1, 19500, 0, 0, 19500]]);
  assert.deepEqual(day.items.map(row => [row.quantity, row.amountCents]), [[2, 20000], [1, 22600]]);
  assert.deepEqual(day.voids.map(v => [v.id, v.status]), [['C', 'voided'], ['D', 'refunded']]);
  const next = summarizeDay(orders, '2026-10-21');
  assert.deepEqual([next.orderCount, next.salesCents, next.voidCount, next.netCents], [1, 22600, 0, 22600]);
  assert.deepEqual(summarizeDay([], '2026-10-20').methods, []);
});

test('Search tokens match in any order, ignore case, and need every word', () => {
  const tokens = searchTokens('  雙控  LED ');
  assert.deepEqual(tokens, ['雙控', 'led']);
  assert.equal(matchesTokens('單位雙控連led指示燈', tokens), true);
  assert.equal(matchesTokens('單位單控連led指示燈', tokens), false);
  assert.equal(matchesTokens('anything', []), true);
});

test('Stored customer and note fields must have the right shape', () => {
  const plain = sale();
  assert.doesNotThrow(() => validateContactFields(plain));
  assert.doesNotThrow(() => validateContactFields(sale({ customer: { name: '陳', phone: '' }, note: 'x' })));
  assert.throws(() => validateContactFields({ ...plain, customer: 'x' }));
  assert.throws(() => validateContactFields({ ...plain, customer: { name: 1, phone: '' } }));
  assert.throws(() => validateContactFields({ ...plain, customer: null }));
  assert.throws(() => validateContactFields({ ...plain, note: 5 }));
});
