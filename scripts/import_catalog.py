#!/usr/bin/env python3
"""Import Wah Fat's PUBLIC storefront catalog. No login, writes, or stock counts.

Run: python3 scripts/import_catalog.py
Replay an existing local snapshot without networking:
     python3 scripts/import_catalog.py --snapshot data/source/20261020T090000Z
Uses the system curl certificate store; TLS verification is never disabled.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import quote, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = 'https://whafat-hk.com'
PAGE_SIZE = 250
MAX_PAGES = 100
# Source anomalies observed on 2026-10-20; match BOTH source ID and exact cents.
# A future source price correction automatically clears the review flag.
# This is deliberately not a general high-price threshold.
OBSERVED_PRICE_REVIEW = {
    39995341635713: 1111100,  # Siemens Arina champagne: double USB.
    39993852723329: 1111100,  # Siemens Arina charcoal: 13A single with USB.
    39993853018241: 1111100,  # Siemens Arina charcoal: double USB.
    39993843417217: 1111100,  # Siemens Arina white: 13A single with USB.
    39993843548289: 1111100,  # Siemens Arina white: 13A double with USB.
}


def price_review_reason(variant_id, price_cents):
    if price_cents == 0:
        return '網站價格為 HK$0，需人工確認'
    if OBSERVED_PRICE_REVIEW.get(variant_id) == price_cents:
        return '網站價格疑似佔位值 HK$11,111，需人工確認'
    return None


def to_cents(value, *, nullable=False):
    """Use decimal strings; never round a float or silently invent a price."""
    if value is None or value == '':
        if nullable:
            return None
        raise ValueError('A variant is missing its sale price')
    try:
        decimal = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f'Invalid price: {value!r}') from exc
    if not decimal.is_finite() or decimal < 0:
        raise ValueError(f'Invalid price: {value!r}')
    cents = decimal * 100
    if cents != cents.to_integral_value():
        raise ValueError(f'Price has fractional cents: {value!r}')
    return int(cents)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


class Snapshot:
    def __init__(self, source, directory, replay=False, delay=0.45):
        self.source = source.rstrip('/')
        self.directory = directory
        self.replay = replay
        self.delay = delay
        self.requests = []
        self.last_request = 0.0
        self.directory.mkdir(parents=True, exist_ok=True)

    def get(self, endpoint, name):
        url = self.source + endpoint
        path = self.directory / name
        if self.replay:
            payload = path.read_bytes()
        else:
            wait = self.delay - (time.monotonic() - self.last_request)
            if wait > 0:
                time.sleep(wait)
            result = subprocess.run([
                'curl', '--fail', '--silent', '--show-error', '--location',
                '--proto', '=https', '--proto-redir', '=https',
                '--max-time', '45', '--retry', '2', '--retry-delay', '1',
                '--user-agent', 'WahFatPOS-PublicCatalogImporter/1.0',
                url,
            ], capture_output=True, check=True)
            self.last_request = time.monotonic()
            payload = result.stdout
            # An anonymous cart GET supplies currency only. Do not retain its token.
            if name == 'currency.json':
                cart = json.loads(payload)
                payload = (json.dumps({'currency': cart.get('currency')}) + '\n').encode()
            path.write_bytes(payload)
        data = json.loads(payload)
        self.requests.append({'url': url, 'file': name, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
        return data

    def paginate(self, endpoint, key, prefix, *, final_empty=True):
        all_items, seen = [], set()
        for page in range(1, MAX_PAGES + 1):
            query = urlencode({'limit': PAGE_SIZE, 'page': page})
            batch = self.get(endpoint + '?' + query, f'{prefix}-page-{page:03d}.json').get(key)
            if not isinstance(batch, list):
                raise ValueError(f'Unexpected {key} response for {endpoint}')
            print(f'{prefix}: page {page}, {len(batch)} records', flush=True)
            if not batch:
                return all_items
            for item in batch:
                identity = item['id']
                if identity in seen:
                    raise ValueError(f'Duplicate ID {identity} during pagination of {endpoint}; source may have changed, rerun import')
                seen.add(identity)
                all_items.append(item)
            if not final_empty and len(batch) < PAGE_SIZE:
                return all_items
        raise ValueError(f'Pagination exceeded {MAX_PAGES} pages for {endpoint}; refusing an incomplete import')


def normalize_product(raw, source, memberships):
    images = [{'id': image['id'], 'src': image['src'], 'alt': image.get('alt')} for image in raw.get('images', [])]
    image_by_variant = {str(vid): image['src'] for image in raw.get('images', []) for vid in image.get('variant_ids', [])}
    variants = []
    for variant in raw['variants']:
        if not isinstance(variant.get('available'), bool):
            raise ValueError(f'No boolean availability for variant {variant.get("id")}')
        featured = variant.get('featured_image') or {}
        normalized_variant = {
            'id': variant['id'], 'title': variant['title'],
            'sku': variant.get('sku'), 'barcode': variant.get('barcode'),
            'priceCents': to_cents(variant.get('price')),
            'compareAtPriceCents': to_cents(variant.get('compare_at_price'), nullable=True),
            'available': variant['available'],
            'option1': variant.get('option1'), 'option2': variant.get('option2'), 'option3': variant.get('option3'),
            'imageUrl': featured.get('src') or image_by_variant.get(str(variant['id'])) or (images[0]['src'] if images else None),
        }
        reason = price_review_reason(variant['id'], normalized_variant['priceCents'])
        if reason:
            normalized_variant['priceReviewReason'] = reason
        variants.append(normalized_variant)
    tags = raw.get('tags') or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
    return {
        'id': raw['id'], 'handle': raw['handle'], 'title': raw['title'],
        'vendor': raw.get('vendor') or '', 'productType': raw.get('product_type') or '', 'tags': tags,
        'sourceUrl': source + '/products/' + quote(raw['handle'], safe=''),
        'images': images,
        'options': [{'name': option['name'], 'position': option['position'], 'values': option['values']} for option in raw.get('options', [])],
        'variants': variants,
        'collectionIds': memberships.get(raw['id'], []),
        'sourceUpdatedAt': raw.get('updated_at'),
    }


def build_catalog(snapshot):
    currency = snapshot.get('/cart.js', 'currency.json').get('currency')
    if currency != 'HKD':
        raise ValueError(f'Expected HKD storefront currency, received {currency!r}')
    raw_products = snapshot.paginate('/products.json', 'products', 'products')
    raw_collections = snapshot.paginate('/collections.json', 'collections', 'collections')
    product_ids = {p['id'] for p in raw_products}
    memberships, collections, warnings = {}, [], []
    for collection in raw_collections:
        endpoint = '/collections/' + quote(collection['handle'], safe='') + '/products.json'
        members = snapshot.paginate(endpoint, 'products', f'collection-{collection["id"]}', final_empty=False)
        member_ids = [p['id'] for p in members]
        unknown = set(member_ids) - product_ids
        if unknown:
            raise ValueError(f'Collection {collection["id"]} contains products absent from main catalog: {sorted(unknown)}')
        for pid in member_ids:
            memberships.setdefault(pid, []).append(collection['id'])
        if len(member_ids) != collection.get('products_count'):
            warnings.append(f'Collection {collection["id"]}: listing reports {collection.get("products_count")}, endpoint returned {len(member_ids)}')
        collections.append({
            'id': collection['id'], 'title': collection['title'], 'handle': collection['handle'],
            'sourceUrl': snapshot.source + '/collections/' + quote(collection['handle'], safe=''),
            'productIds': member_ids, 'productCount': len(member_ids),
        })
    products = [normalize_product(p, snapshot.source, memberships) for p in raw_products]
    variants = [variant for p in products for variant in p['variants']]
    variant_ids = [variant['id'] for variant in variants]
    if len(variant_ids) != len(set(variant_ids)):
        raise ValueError('Duplicate variant IDs across products')
    skus = Counter(v['sku'] for v in variants if v['sku'])
    all_prices = [v['priceCents'] for v in variants]
    # Preserve snapshot capture time on offline replay.
    manifest_path = snapshot.directory / 'manifest.json'
    imported_at = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    if snapshot.replay and manifest_path.exists():
        imported_at = json.loads(manifest_path.read_text())['importedAt']
    summary = {
        'productCount': len(products), 'variantCount': len(variants), 'collectionCount': len(collections),
        'imageCount': sum(len(p['images']) for p in products),
        'uniqueImageCount': len({im['src'] for p in products for im in p['images']}),
        'availableVariantCount': sum(v['available'] for v in variants),
        'unavailableVariantCount': sum(not v['available'] for v in variants),
        'productsWithoutImages': sum(not p['images'] for p in products),
        'productsWithoutCollection': sum(not p['collectionIds'] for p in products),
        'variantsWithoutSku': sum(not v['sku'] for v in variants),
        'variantsWithoutBarcode': sum(not v['barcode'] for v in variants),
        'duplicateSkuValueCount': sum(count > 1 for count in skus.values()),
        'zeroPriceVariantCount': sum(price == 0 for price in all_prices),
        'priceReviewVariantCount': sum(bool(v.get('priceReviewReason')) for v in variants),
        'minPriceCents': min(all_prices, default=None), 'maxPriceCents': max(all_prices, default=None),
        'sourceProductPageCount': sum(r['file'].startswith('products-page-') for r in snapshot.requests),
        'sourceRequestCount': len(snapshot.requests),
        'warnings': warnings,
        'limitations': [
            'Public storefront snapshot only; not an administrative export.',
            'Availability is the website availability flag, not a verified in-store stock count.',
            'Barcode values are null when the public response does not expose them.',
            'Image URLs reference the source Shopify CDN; offline image availability is not guaranteed.',
            'Importing does not update website orders or inventory.',
        ],
    }
    catalog = {'schemaVersion': 1, 'sourceUrl': snapshot.source + '/', 'currency': currency,
               'importedAt': imported_at, 'products': products, 'collections': collections, 'summary': summary}
    if not snapshot.replay:
        write_json(manifest_path, {'sourceUrl': snapshot.source + '/', 'importedAt': imported_at, 'requests': snapshot.requests, 'summary': summary})
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-url', default=DEFAULT_SOURCE)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/data/catalog.json')
    parser.add_argument('--snapshot', type=Path, help='Replay a prior snapshot folder without network requests')
    parser.add_argument('--delay', type=float, default=0.45, help='Seconds between sequential requests; minimum 0.25')
    args = parser.parse_args()
    if urlparse(args.source_url).scheme != 'https':
        parser.error('Source URL must use HTTPS')
    if args.delay < .25:
        parser.error('Delay must be at least 0.25 seconds')
    snapshot_dir = args.snapshot or ROOT / 'data/source' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snapshot = Snapshot(args.source_url, snapshot_dir, replay=bool(args.snapshot), delay=args.delay)
    catalog = build_catalog(snapshot)
    write_json(args.output, catalog)
    print(json.dumps({'output': str(args.output), 'snapshot': str(snapshot_dir), 'summary': catalog['summary']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
