import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root, 'dist/data/catalog.json'), 'utf8'));
const sourceRoot = path.join(root, 'data/source');
const snapshots = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
  .map(entry => entry.name).sort();
assert.ok(snapshots.length, 'At least one captured website snapshot is required');
const snapshot = path.join(sourceRoot, snapshots.at(-1));
const pages = (await readdir(snapshot)).filter(name => /^products-page-\d+\.json$/.test(name)).sort();
const originals = (await Promise.all(pages.map(async name =>
  JSON.parse(await readFile(path.join(snapshot, name), 'utf8')).products))).flat();
const byId = new Map(originals.map(product => [product.id, product]));

function websiteCents(value) {
  if (value == null) return null;
  const parts = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  assert.ok(parts, `Source price must be a non-negative decimal: ${value}`);
  return Number(parts[1]) * 100 + Number((parts[2] || '').padEnd(2, '0'));
}

test('Imported catalog contains every website product exactly once', () => {
  assert.equal(catalog.currency, 'HKD');
  assert.equal(catalog.products.length, originals.length);
  assert.equal(new Set(catalog.products.map(product => product.id)).size, originals.length);
  assert.deepEqual(new Set(catalog.products.map(product => product.id)), new Set(byId.keys()));
});

test('Every variant retains the exact source price, availability, and SKU', () => {
  let variants = 0;
  for (const product of catalog.products) {
    const source = byId.get(product.id);
    assert.equal(product.title, source.title);
    assert.equal(product.variants.length, source.variants.length);
    const sourceVariants = new Map(source.variants.map(variant => [variant.id, variant]));
    for (const variant of product.variants) {
      const original = sourceVariants.get(variant.id);
      assert.ok(original, `Unexpected variant ${variant.id}`);
      assert.equal(variant.title, original.title);
      assert.equal(variant.priceCents, websiteCents(original.price), `Price mismatch ${variant.id}`);
      assert.equal(variant.compareAtPriceCents, websiteCents(original.compare_at_price));
      assert.equal(variant.available, original.available, `Availability mismatch ${variant.id}`);
      assert.equal(variant.sku, original.sku);
      assert.ok(Number.isSafeInteger(variant.priceCents));
      variants++;
    }
  }
  assert.ok(variants > 0);
});

test('Product and variant images come from the captured website data', () => {
  for (const product of catalog.products) {
    const source = byId.get(product.id);
    const imageSources = new Set(source.images.map(image => image.src));
    assert.deepEqual(product.images.map(image => image.src), source.images.map(image => image.src));
    for (const variant of product.variants) {
      if (variant.imageUrl) {
        assert.ok(imageSources.has(variant.imageUrl), `Unverified image URL for ${variant.id}`);
        assert.equal(new URL(variant.imageUrl).protocol, 'https:');
      }
    }
    assert.equal(new URL(product.sourceUrl).hostname, 'whafat-hk.com');
  }
});

test('Collection references point to imported products', () => {
  const collectionIds = new Set(catalog.collections.map(collection => collection.id));
  for (const collection of catalog.collections) {
    for (const id of collection.productIds) assert.ok(byId.has(id), `Unknown product ${id}`);
  }
  for (const product of catalog.products) {
    for (const id of product.collectionIds) assert.ok(collectionIds.has(id), `Unknown collection ${id}`);
  }
});
