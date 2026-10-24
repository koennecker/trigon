// Ratchet test for the section registry: every targeted table-section
// rebuild goes through refreshSection(s) with its anchor and dependency
// declared in tableSections, and the old combined refresh is gone.
// The registry itself lives in app.js (not imported by node), so this
// test reads app.js source, like listener-rule.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function slice(from, to) {
  const a = app.indexOf(from);
  assert.notEqual(a, -1, `missing marker: ${from}`);
  const b = to ? app.indexOf(to, a + from.length) : app.length;
  assert.notEqual(b, -1, `missing marker: ${to}`);
  return app.slice(a, b);
}

describe('section registry', () => {
  it('declares lots, catalog, lords, syzygy with anchors and dependencies', () => {
    const reg = slice('const tableSections = {', 'function refreshSections');
    for (const [id, anchor] of [
      ['lots', '#panel-table #lots-section'],
      ['catalog', '#panel-table #catalog-selected'],
      ['lords', '#panel-table #lords-section'],
      ['syzygy', '#panel-table #syzygy-section'],
    ]) {
      assert.ok(reg.includes(`${id}: {`), `missing section ${id}`);
      assert.ok(reg.includes(`anchor: '${anchor}'`), `missing anchor for ${id}`);
    }
    assert.ok(reg.includes("dependsOn: ['syzygyLon']"), 'no section declares syzygyLon');
    const catalog = reg.slice(reg.indexOf('catalog: {'), reg.indexOf('lords: {'));
    const lords = reg.slice(reg.indexOf('lords: {'), reg.indexOf('syzygy: {'));
    assert.ok(catalog.includes("dependsOn: ['syzygyLon']"), 'catalog must depend on syzygyLon');
    assert.ok(lords.includes("dependsOn: ['syzygyLon']"), 'lords must depend on syzygyLon');
  });
  it('the old combined refresh is gone; all targeted rebuilds go through the registry', () => {
    assert.ok(!app.includes('refreshCatalogAndLords'), 'refreshCatalogAndLords must not remain');
    const change = slice("document.addEventListener('change'", 'document.addEventListener(\'click\'');
    assert.ok(change.includes("refreshSections(['catalog', 'lords'])"), 'cat-sel must refresh catalog+lords');
    assert.ok(change.includes("refreshSection('lots')"), 'lots-opt must refresh lots only');
    const extras = slice('function maybeRefreshExtras', 'function parseShareHash');
    assert.ok(extras.includes("refreshSection('syzygy', { syz })"), 'extras scan must refresh syzygy via the registry');
    assert.ok(!extras.includes('buildSyzygyHTML(syz)'), 'extras scan must not swap the syzygy section ad hoc');
  });
  it('the syzygy subscription refreshes sections by declared dependency, not by name', () => {
    const sub = slice("subscribe(['syzygyLon']", 'function maybeRefreshExtras');
    assert.ok(sub.includes('dependsOn'), 'subscription must filter by dependsOn');
    assert.ok(sub.includes('refreshSections('), 'subscription must refresh via the registry');
    assert.ok(!sub.includes('refreshCatalogAndLords'), 'subscription must not call the old refresh');
  });
});
