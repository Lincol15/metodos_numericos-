import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectNearestNodes, lagrangeInterpolation, makeInterpolant } from '../src/math/lagrange.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} esperado ${b}, obtenido ${a}`);
const XS = [2.0, 2.2, 2.4, 2.6, 2.8];
const YS = [0.5103757, 0.5207843, 0.5104147, 0.4813306, 0.4359160];
const pick = (g, t = 2.5) => selectNearestNodes(XS, t, g + 1).map((i) => XS[i]);

test('ejemplo: selección automática con empates', () => {
  assert.deepEqual(pick(1), [2.4, 2.6]);
  assert.deepEqual(pick(2), [2.2, 2.4, 2.6]);
  assert.deepEqual(pick(3), [2.2, 2.4, 2.6, 2.8]);
});

test('ejemplo: valores P1, P2, P3 en x = 2.5', () => {
  const val = (g) => { const idx = selectNearestNodes(XS, 2.5, g + 1); return lagrangeInterpolation(idx.map((i) => XS[i]), idx.map((i) => YS[i]), 2.5); };
  close(val(1).value, 0.49587265, 1e-12); close(val(2).value, 0.4982119625, 1e-12); close(val(3).value, 0.4980629625, 1e-12);
  [1, 2, 3].forEach((g) => { const r = val(g); assert.ok(r.agree && r.sumOk && r.reproduction.every((p) => p.ok)); assert.equal(r.extrapolation, false); });
});

test('función lineal y cuadrática se reproducen exactamente', () => {
  const lin = lagrangeInterpolation([-1, 3], [-1, 7], 10); close(lin.value, 21, 1e-12); assert.equal(lin.extrapolation, true);
  const q = (x) => 2 * x * x - x + 4;
  const nx = [-2, 0.5, 3];
  close(lagrangeInterpolation(nx, nx.map(q), 1.7).value, q(1.7), 1e-12);
  close(lagrangeInterpolation(nx, nx.map(q), 1.7).classic, q(1.7), 1e-12);
});

test('nodos no equidistantes (cúbica)', () => {
  const f = (x) => x ** 3 - 2 * x; const nx = [-3, -0.4, 1, 5.5];
  close(lagrangeInterpolation(nx, nx.map(f), 2.2).value, f(2.2), 1e-10);
});

test('evaluación exactamente en un nodo', () => {
  const r = lagrangeInterpolation([1, 2, 4], [3, -5, 8], 2);
  assert.equal(r.value, -5); assert.equal(r.nodeHit, 1);
  assert.deepEqual(r.contributions.map((c) => c.L + 0), [0, 1, 0]); // + 0 normaliza −0
});

test('empate exacto: prefiere el menor xi', () => {
  assert.deepEqual(selectNearestNodes([0, 1, 2, 3], 1.5, 1).map((i) => [0, 1, 2, 3][i]), [1]);
  assert.deepEqual(selectNearestNodes([3, 2, 1, 0], 1.5, 3).map((i) => [3, 2, 1, 0][i]), [0, 1, 2]);
});

test('extrapolación respecto de los nodos seleccionados', () => {
  // x = 2.5 está dentro del rango de todos los datos, pero fuera de [2.0, 2.2]
  assert.equal(lagrangeInterpolation([2.0, 2.2], [0.5103757, 0.5207843], 2.5).extrapolation, true);
});

test('el interpolante de la gráfica usa un solo conjunto fijo de nodos', () => {
  const nx = [2.2, 2.4, 2.6]; const ny = [0.5207843, 0.5104147, 0.4813306];
  const p = makeInterpolant(nx, ny);
  nx.forEach((x, i) => close(p(x), ny[i], 1e-15));
  close(p(2.5), lagrangeInterpolation(nx, ny, 2.5).classic, 1e-12);
  close(p(3.5), lagrangeInterpolation(nx, ny, 3.5).classic, 1e-12);
});
