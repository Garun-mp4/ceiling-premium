import { test } from 'node:test';
import assert from 'node:assert/strict';
import cases from './calculation-cases.json' with { type: 'json' };
import { calculate, defaults, normalizePhone, validateCalculation } from '../src/lib/pricing.ts';

for (const fixture of cases)
  test(`price: ${fixture.name}`, () => {
    const { input, errors } = validateCalculation(fixture.input);
    assert.deepEqual(errors, {});
    assert.ok(input);
    const result = calculate(input);
    for (const [key, expected] of Object.entries(fixture.expected))
      assert.equal(result[key as keyof typeof fixture.expected], expected);
  });
test('bad inputs are rejected instead of silently clamped', () => {
  for (const [key, value] of [
    ['area', 1.99],
    ['area', 201],
    ['area', ''],
    ['area', '0x10'],
    ['area', '1e2'],
    ['area', true],
    ['area', Infinity],
    ['perimeter', -1],
    ['lights', 1.5],
    ['lights', -1],
    ['corners', 3],
    ['pipes', 0.5],
    ['material', 'wood'],
    ['profile', '__proto__'],
  ]) {
    const result = validateCalculation({ ...defaults, [key]: value });
    assert.ok(result.errors[String(key)], `${key}=${value}`);
    assert.equal(result.input, undefined);
  }
});
test('area and perimeter are independent', () => {
  const a = calculate({ ...defaults, area: 40, perimeter: 20 }),
    b = calculate({ ...defaults, area: 40, perimeter: 30 });
  assert.equal(b.subtotal - a.subtotal, 2000);
});
test('Russian phone paste, local and trunk formats agree', () => {
  for (const value of ['+7 (996) 420-65-69', '8 996 420 65 69', '9964206569'])
    assert.equal(normalizePhone(value), '+79964206569');
  for (const value of ['', '+12345678901', '7996', '899642065699', 'abc79964206569'])
    assert.equal(normalizePhone(value), null);
});
