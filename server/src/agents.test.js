import test from 'node:test';
import assert from 'node:assert/strict';
import { executeToolCall, safeEvaluateMathExpression } from './agents.js';

test('evaluates operator precedence and parentheses', () => {
  assert.equal(safeEvaluateMathExpression('2 + 2 * (3 - 1)'), 6);
});

test('supports unary minus', () => {
  assert.equal(safeEvaluateMathExpression('-5 + 2 * 3'), 1);
});

test('supports decimal values', () => {
  assert.equal(safeEvaluateMathExpression('3.5 * 2'), 7);
});

test('throws on division by zero', () => {
  assert.throws(() => safeEvaluateMathExpression('10 / (5 - 5)'), /division by zero/i);
});

test('throws on unsupported characters', () => {
  assert.throws(() => safeEvaluateMathExpression('1 + process.exit(1)'), /unsupported character/i);
});

test('throws on mismatched parentheses', () => {
  assert.throws(() => safeEvaluateMathExpression('(1 + 2'), /mismatched parentheses/i);
});

test('throws on malformed number', () => {
  assert.throws(() => safeEvaluateMathExpression('1..2 + 3'), /invalid number format/i);
});

test('throws on empty expressions', () => {
  assert.throws(() => safeEvaluateMathExpression('   '), /empty expression/i);
});

test("executeToolCall('calculate') integrates parser and tool output", async () => {
  const result = await executeToolCall(
    'calculate',
    { expression: '12 / 3 + 4 * (2 - 0.5)' },
    { db: null, retrieveContextForOrg: async () => [], orgId: 1 }
  );

  assert.deepEqual(result, {
    expression: '12 / 3 + 4 * (2 - 0.5)',
    result: 10
  });
});
