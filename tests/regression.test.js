import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polynomialRegression, regressionPreconditions } from '../src/math/regression.js';
import { gaussJordanInverse } from '../src/math/matrices.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} esperado ${b}, obtenido ${a}`);

test('recta exacta: y = 3 − 2x', () => {
  const xs = [-2, -1, 0, 1.5, 4];
  const r = polynomialRegression(xs, xs.map((x) => 3 - 2 * x), 1);
  close(r.fit.a[0], 3, 1e-12); close(r.fit.a[1], -2, 1e-12);
  close(r.Sr, 0, 1e-20); close(r.R2, 1, 1e-12);
  assert.ok(r.corr.r < 0, 'correlación inversa');
});

test('parábola exacta: y = 1 + 0.5x − 2x²', () => {
  const xs = [0, 1, 2, 3, 5, 8];
  const r = polynomialRegression(xs, xs.map((x) => 1 + 0.5 * x - 2 * x * x), 2);
  r.fit.a.forEach((a, j) => close(a, [1, 0.5, -2][j], 1e-10, `a${j}`));
  r.normal.a.forEach((a, j) => close(a, [1, 0.5, -2][j], 1e-8, `C⁻¹b a${j}`));
  assert.ok(r.comparison.agree);
});

test('ejemplo suministrado (m = 2, x = 7)', () => {
  const r = polynomialRegression([0, 1, 2, 3, 4, 5], [2.1, 7.7, 13.6, 27.2, 40.9, 61.1], 2, [7]);
  close(r.fit.a[0], 2.4786, 5e-5, 'a0'); close(r.fit.a[1], 2.3593, 5e-5, 'a1'); close(r.fit.a[2], 1.8607, 5e-5, 'a2');
  close(r.s, 1.1175, 5e-5, 's'); close(r.R2, 0.9985, 5e-5, 'R²'); close(r.R, 0.9993, 5e-5, 'R');
  close(r.predictions[0].value, 110.1686, 5e-5, 'P(7)');
  assert.equal(r.predictions[0].extrapolation, true);
  assert.equal(r.dof, 3);
  // la predicción no usa coeficientes redondeados
  const rounded = r.fit.a.map((a) => Number(a.toFixed(4)));
  assert.notEqual(rounded[0] + rounded[1] * 7 + rounded[2] * 49, r.predictions[0].value);
});

test('n = m + 1: interpola, gl = 0 y s no definido', () => {
  const r = polynomialRegression([1, 2, 4], [5, -1, 7], 2);
  assert.equal(r.dof, 0); assert.equal(r.s, null); assert.equal(r.distinctX, true);
  r.residuals.forEach((e) => close(e, 0, 1e-12));
});

test('yi constantes: St = 0, R² no definido, Pearson no definido', () => {
  const r = polynomialRegression([0, 1, 2, 3], [4, 4, 4, 4], 1);
  assert.equal(r.St, 0); assert.equal(r.R2, null); assert.equal(r.corr.r, null);
  close(r.fit.a[0], 4, 1e-12); close(r.fit.a[1], 0, 1e-12);
});

test('xi repetidos permitidos con suficientes valores distintos', () => {
  const r = polynomialRegression([1, 1, 2, 2, 3], [1, 3, 2, 4, 5], 1);
  assert.equal(r.distinctX, false); assert.equal(r.dof, 3);
  close(r.fit.a[1], 4 / 2.8, 1e-12); // Sxy / Sxx = 4 / 2.8
});

test('cantidad insuficiente de xi distintos', () => {
  assert.ok(regressionPreconditions([1, 1, 2, 2], 2).some((e) => e.includes('valores distintos')));
  assert.throws(() => polynomialRegression([1, 1, 2, 2], [1, 2, 3, 4], 2), /valores distintos/);
  assert.throws(() => polynomialRegression([1, 2], [1, 2], 2), /al menos m \+ 1/);
});

test('valores negativos y de gran magnitud', () => {
  const xs = [-3e5, -1e5, 2e5, 5e5, 9e5];
  const ys = xs.map((x) => -7 + 2e-3 * x + 4e-11 * x * x);
  const r = polynomialRegression(xs, ys, 2);
  close(r.fit.evaluate(1e5), -7 + 2e2 + 4e-1, 1e-6);
  close(r.R2, 1, 1e-10);
});

test('Gauss-Jordan detecta matriz singular y no inventa la inversa', () => {
  const g = gaussJordanInverse([[1, 2], [2, 4]]);
  assert.equal(g.ok, false); assert.equal(g.inverse, undefined);
  const ok = gaussJordanInverse([[0, 2], [3, 1]]);
  assert.ok(ok.ok && ok.steps[0].swap, 'pivoteo parcial intercambia filas');
  close(ok.inverse[0][0], -1 / 6, 1e-15);
});

test('desbordamiento de potencias', () => {
  assert.throws(() => polynomialRegression([1e40, 2e40, 3e40, 4e40], [1, 2, 3, 4], 8), /Desbordamiento|al menos/);
  assert.throws(() => polynomialRegression([1e80, 2e80, 3e80], [1, 2, 3], 2), /Desbordamiento/);
});
