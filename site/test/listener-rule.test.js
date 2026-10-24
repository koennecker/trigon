// Ratchet for the listener rule: render functions never attach
// listeners; DOM rebuilt by a render is wired by delegation on a static
// ancestor, attached once. Rebuilt nodes drop per-node listeners with
// the old tree, so attaching inside a render is both redundant and
// fragile — this test fails if it comes back.
// Run: node --test test/listener-rule.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function src(name) {
  return readFile(new URL(`../${name}`, import.meta.url), 'utf8');
}

// Slice of one function declaration, up to the next declaration at the
// same indent or end of file. Nested bodies use deeper indent or arrow
// functions, so they never terminate the slice early.
function fnBody(source, name, indent = '') {
  const start = source.indexOf(`\n${indent}function ${name}(`);
  assert.notEqual(start, -1, `${name} is declared`);
  const rest = source.slice(start + 1);
  const end = rest.search(new RegExp(`\n${indent}function `));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('render functions attach no listeners', () => {
  it('app.js render and refresh paths wire nothing', async () => {
    const app = await src('app.js');
    for (const name of ['renderResults', 'updateLiveResults', 'rerenderChartSVG',
      'refreshSections', 'refreshSection', 'maybeRefreshExtras']) {
      assert.ok(!fnBody(app, name).includes('addEventListener'),
        `${name} attaches a listener`);
    }
    assert.ok(!fnBody(app, 'renderResults').includes('shareChart'),
      'share button is delegated, not wired per render');
    assert.ok(!fnBody(app, 'renderResults').includes('copyDebug'),
      'debug button is delegated, not wired per render');
  });
  it('rebuilt and transient lists wire nothing per item', async () => {
    const loc = await src('location.js');
    assert.ok(!fnBody(loc, 'renderCityResults', '  ').includes('addEventListener'),
      'city suggestions are delegated, not wired per item');
    const dt = await src('datetime.js');
    assert.ok(!fnBody(dt, 'renderSuggest', '  ').includes('b.addEventListener'),
      'month suggestions are delegated at popup creation, not wired per item');
  });
});

describe('delegation exists for the rebuilt controls', () => {
  it('share, debug-copy, city, and month controls are delegated', async () => {
    const app = await src('app.js');
    assert.ok(app.includes("closest('#share')"), 'share button delegated');
    assert.ok(app.includes("closest('#dbgcopy')"), 'debug button delegated');
    const loc = await src('location.js');
    assert.ok(loc.includes("el('city-results').addEventListener('mousedown'"),
      'city suggestions delegated');
    const dt = await src('datetime.js');
    assert.ok(dt.includes("mpanel.addEventListener('pointerdown'"),
      'month suggestions delegated');
  });
});
