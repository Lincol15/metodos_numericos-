import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTwoColumns, parseValueList } from '../src/utils/parsing.js';
import { parseNumber } from '../src/shared/format.js';

test('tabulaciones con coma decimal, encabezado y columna i', () => {
  const r = parseTwoColumns('i\tx\ty\n0\t1,5\t-2\n1\t2,5\t3,25\n');
  assert.equal(r.delimiter, 'tab');
  assert.ok(r.header);
  assert.equal(r.indexColumn, true);
  assert.deepEqual(r.lines.map((l) => [l.x, l.y]), [[1.5, -2], [2.5, 3.25]]);
});

test('coma como delimitador exige punto decimal', () => {
  const r = parseTwoColumns('1.5,2\n3,4.25');
  assert.equal(r.delimiter, 'comma');
  assert.ok(r.lines.every((l) => l.ok));
});

test('punto y coma y espacios', () => {
  assert.deepEqual(parseTwoColumns('1,5;2\n-3;0').lines.map((l) => l.x), [1.5, -3]);
  assert.deepEqual(parseTwoColumns('1 2\n  3   4 ').lines.map((l) => l.y), [2, 4]);
});

test('líneas inválidas quedan identificadas, no se descartan', () => {
  const r = parseTwoColumns('1\t2\n3\t\nabc\t4\n5\t6\t7\n8\t9');
  assert.equal(r.lines.length, 5);
  assert.deepEqual(r.lines.map((l) => l.ok), [true, false, false, false, true]);
  assert.match(r.lines[1].error, /y vacío/);
  assert.match(r.lines[3].error, /2 columnas/);
});

test('campos vacíos no son cero; sin separadores de miles', () => {
  assert.equal(parseNumber('').empty, true);
  assert.equal(parseNumber('1.234,5').error, true);
  assert.equal(parseNumber('1e400').error, true);
  assert.equal(parseNumber('-0,25').value, -0.25);
});

test('listas de predicciones', () => {
  assert.deepEqual(parseValueList('7; 8,5\n-1').values, [7, 8.5, -1]);
  assert.deepEqual(parseValueList('1.5, 2, 3').values, [1.5, 2, 3]);
  assert.deepEqual(parseValueList('1,5').values, [1.5]);
  assert.equal(parseValueList('2;;x').errors.length, 1);
});
