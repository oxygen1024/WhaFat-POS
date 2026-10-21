import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// GitHub Pages lets browsers cache files for 10 minutes. A module imported without the per-deploy
// ?v=__BUILD__ stamp can be served stale next to a fresh app.js (e.g. a missing cloud.hasAccess()).
test('Every local module import and page asset carries the build stamp', async () => {
  const dist = new URL('../dist/', import.meta.url);
  const files = (await readdir(dist)).filter(name => /\.(js|html)$/.test(name) && name !== 'sw.js');
  const unstamped = [];
  for (const name of files) {
    const text = await readFile(new URL(name, dist), 'utf8');
    const refs = [...text.matchAll(/(?:from\s+|import\s*\(\s*|src=|href=)['"](\.\/[^'"]+\.(?:js|css))(\?[^'"]*)?['"]/g)];
    for (const [, path, query] of refs) if (!query?.includes('v=__BUILD__')) unstamped.push(`${name}: ${path}`);
  }
  assert.deepEqual(unstamped, []);
});
