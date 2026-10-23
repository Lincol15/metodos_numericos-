import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dividedDifferences, evalNewton } from '../src/newton/newton-math.js';
import { jacobi, jacobiStep, findRowPermutation } from '../src/jacobi/jacobi-math.js';

test('Newton: ejemplo de Burden-Faires', () => {
  const xs = [1, 1.3, 1.6, 1.9, 2.2];
  const D = dividedDifferences(xs, [0.7651977, 0.620086, 0.4554022, 0.2818186, 0.1103623]);
  assert.equal(evalNewton(D[0], xs, 1.5).toFixed(7), '0.5118200');
});

test('Jacobi: la primera iteración usa solo x⁽⁰⁾ y el ejemplo converge', () => {
  const A = [[10, -1, 2], [-1, 11, -1], [2, -1, 10]];
  const b = [6, 22, -10];
  assert.deepEqual(jacobiStep(A, b, [0, 0, 0]), [0.6, 2, -1]);
  const r = jacobi(A, b, [0, 0, 0], 1e-4, 100);
  assert.equal(r.status, 'converged');
  r.iterations.at(-1).x.forEach((v, i) => assert.ok(Math.abs(v - [1, 2, -1][i]) < 1e-4));
});

test('Jacobi: reordenamiento por cero diagonal y máximo de iteraciones', () => {
  assert.deepEqual(findRowPermutation([[0, 2, 1], [3, 0, 1], [1, 1, 5]]).perm, [1, 0, 2]);
  assert.equal(findRowPermutation([[0, 1, 0], [0, 2, 0], [1, 1, 1]]), null);
  assert.equal(jacobi([[1, 2], [3, 1]], [3, 4], [0, 0], 1e-4, 25).status, 'maxIter');
});
