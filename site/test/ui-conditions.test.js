// Kent C. Dodds-style integration tests for the aspect-condition UI
// builders (search-ui.js). These builders were closure functions inside
// createSearchUI and had no browserless test at all; they are now
// exported pure builders. Each test renders the builder output into a
// jsdom document and queries it the way a user would: by accessible
// name, by button text, by selected option — never by string-matching
// the raw HTML.
// Run: node --test test/ui-conditions.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { condFieldsHTML, condRowHTML, condGroupHTML } from '../search-ui.js';

function render(html) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  dom.window.document.body.innerHTML = html;
  return dom.window.document;
}
const select = (doc, label) => doc.querySelector(`select[aria-label="${label}"]`);
const input = (doc, label) => doc.querySelector(`input[aria-label="${label}"]`);
const button = (doc, text) => [...doc.querySelectorAll('button')]
  .find(b => b.textContent.trim() === text);

describe('condFieldsHTML, by condition type', () => {
  it('sign condition: who, mode, and value selects with the given values', () => {
    const doc = render(condFieldsHTML({ type: 'sign', who: 'b', mode: 'element', value: 2 }));
    assert.equal(select(doc, 'Whose sign').value, 'b');
    assert.equal(select(doc, 'Sign filter').value, 'element');
    assert.equal(select(doc, 'Sign filter value').value, '2');
    assert.equal(select(doc, 'Sign filter value').selectedOptions[0].textContent, 'Air');
  });

  it('sign condition defaults to A, is-in-sign, Aries', () => {
    const doc = render(condFieldsHTML({ type: 'sign' }));
    assert.equal(select(doc, 'Whose sign').value, 'a');
    assert.equal(select(doc, 'Sign filter').value, 'sign');
    assert.equal(select(doc, 'Sign filter value').selectedOptions[0].textContent, 'Aries');
  });

  it('aspect condition: bodies, degree, mode, and orb', () => {
    const doc = render(condFieldsHTML({ type: 'aspect', from: 2, to: 4, deg: 120, mode: 'orb', orb: 5 }));
    assert.equal(select(doc, 'From body').value, '2');
    assert.equal(select(doc, 'To body').value, '4');
    assert.equal(select(doc, 'Aspect').value, '120');
    assert.equal(select(doc, 'Aspect mode').value, 'orb');
    assert.equal(input(doc, 'Orb in degrees').value, '5');
    assert.equal(input(doc, 'Orb in degrees').disabled, false);
  });

  it('aspect condition in sign mode disables the orb input', () => {
    const doc = render(condFieldsHTML({ type: 'aspect', mode: 'signbased' }));
    assert.equal(select(doc, 'Aspect mode').value, 'signbased');
    assert.equal(input(doc, 'Orb in degrees').disabled, true);
  });

  it('motion condition: body and direction', () => {
    const doc = render(condFieldsHTML({ type: 'motion', body: 4, dir: 'retrograde' }));
    assert.equal(select(doc, 'Body').value, '4');
    assert.equal(select(doc, 'Direction').value, 'retrograde');
  });

  it('speed condition: body and percentile range inputs', () => {
    const doc = render(condFieldsHTML({ type: 'speed', body: 3, min: 10, max: 90 }));
    assert.equal(select(doc, 'Body').value, '3');
    assert.equal(input(doc, 'Minimum percentile').value, '10');
    assert.equal(input(doc, 'Maximum percentile').value, '90');
    assert.match(doc.body.textContent, /speed percentile/);
  });

  it('phase condition: Sun is not a selectable body, phase is selected', () => {
    const doc = render(condFieldsHTML({ type: 'phase', body: 3, phase: 'combust' }));
    const body = select(doc, 'Body');
    assert.equal(body.value, '3');
    assert.equal(body.querySelector('option[value="0"]').disabled, true);
    assert.equal(select(doc, 'Phase').value, 'combust');
  });

  it('unknown type falls back to the sign fields', () => {
    const doc = render(condFieldsHTML({ type: 'nope' }));
    assert.ok(select(doc, 'Whose sign'));
    assert.ok(select(doc, 'Sign filter'));
  });
});

describe('condRowHTML and condGroupHTML', () => {
  it('a row carries its type select, its fields, and a remove button', () => {
    const doc = render(condRowHTML({ type: 'motion', body: 4, dir: 'retrograde' }));
    assert.equal(select(doc, 'Condition type').value, 'motion');
    assert.equal(select(doc, 'Direction').value, 'retrograde');
    assert.ok(button(doc, 'remove'));
  });

  it('a group numbers itself, joins rows with OR, and offers add/remove', () => {
    const doc = render(condGroupHTML([
      { type: 'sign', who: 'a', mode: 'sign', value: 0 },
      { type: 'motion', body: 4, dir: 'direct' },
    ], 1));
    assert.match(doc.body.textContent, /Group 2 — any of \(OR\)/);
    assert.equal(doc.querySelectorAll('.cond-row').length, 2);
    assert.equal(doc.querySelectorAll('.cond-or').length, 1);
    assert.ok(button(doc, 'remove group'));
    assert.ok(button(doc, 'add OR condition'));
  });

  it('changing a rendered select keeps the other fields intact', () => {
    // The user interaction a real UI does: pick a different body in a
    // rendered row, then read the row back. The DOM, not the string,
    // is the source of truth here.
    const doc = render(condRowHTML({ type: 'motion', body: 2, dir: 'direct' }));
    const body = select(doc, 'Body');
    body.value = '4';
    assert.equal(body.value, '4');
    assert.equal(select(doc, 'Direction').value, 'direct');
  });
});
