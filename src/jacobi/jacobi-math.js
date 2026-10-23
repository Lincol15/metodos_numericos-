/* =========================================================
   Método de Jacobi para Ax = b (sin dependencias de la interfaz)
   ========================================================= */

/** Norma infinito de un vector: máximo valor absoluto de sus componentes. */
export const normInf = (v) => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

export const matVec = (A, x) => A.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));

/** Vector residuo r = Ax − b. */
export const residualVector = (A, x, b) => matVec(A, x).map((v, i) => v - b[i]);

/** Índices i con aii = 0. */
export const zeroDiagonal = (A) => A.map((row, i) => (row[i] === 0 ? i : -1)).filter((i) => i >= 0);

/** Dominancia diagonal estricta por filas: |aii| > Σ_{j≠i} |aij|. */
export function diagonalDominance(A) {
  const rows = A.map((row, i) => {
    const diag = Math.abs(row[i]);
    const off = row.reduce((s, a, j) => (j === i ? s : s + Math.abs(a)), 0);
    return { i, diag, off, strict: diag > off };
  });
  return { rows, strict: rows.every((r) => r.strict) };
}

/** Forma matricial x⁽ᵏ⁺¹⁾ = T·x⁽ᵏ⁾ + c, con Tii = 0, Tij = −aij/aii, ci = bi/aii. */
export function iterationMatrix(A, b) {
  const T = A.map((row, i) => row.map((a, j) => (j === i ? 0 : -a / row[i])));
  const c = b.map((bi, i) => bi / A[i][i]);
  return { T, c };
}

/**
 * Un paso de Jacobi. Lee únicamente `prev` y escribe en un vector nuevo,
 * de modo que ninguna componente nueva se usa dentro de la misma iteración
 * (eso sería Gauss-Seidel).
 */
export function jacobiStep(A, b, prev) {
  const n = b.length;
  const next = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) if (j !== i) sum += A[i][j] * prev[j];
    next[i] = (b[i] - sum) / A[i][i];
  }
  return next;
}

/**
 * Itera hasta que Ek = ||x⁽ᵏ⁾ − x⁽ᵏ⁻¹⁾||∞ ≤ tol y Rk = ||Ax⁽ᵏ⁾ − b||∞ ≤ tol,
 * o hasta maxIter. status: 'converged' | 'maxIter' | 'nonFinite'.
 */
export function jacobi(A, b, x0, tol, maxIter) {
  const r0 = normInf(residualVector(A, x0, b));
  const iterations = [{ k: 0, x: x0.slice(), change: null, residual: r0 }];
  if (!Number.isFinite(r0)) return { iterations, status: 'nonFinite', failedAt: 0, tol, maxIter };

  let prev = x0.slice();
  for (let k = 1; k <= maxIter; k++) {
    const next = jacobiStep(A, b, prev);
    const change = normInf(next.map((v, i) => v - prev[i]));
    const residual = normInf(residualVector(A, next, b));
    if (!next.every(Number.isFinite) || !Number.isFinite(change) || !Number.isFinite(residual)) {
      return { iterations, status: 'nonFinite', failedAt: k, tol, maxIter };
    }
    iterations.push({ k, x: next, change, residual });
    if (change <= tol && residual <= tol) return { iterations, status: 'converged', tol, maxIter };
    prev = next;
  }
  return { iterations, status: 'maxIter', tol, maxIter };
}

/**
 * Busca una permutación de filas (ecuaciones) con diagonal sin ceros.
 * perm[nuevaFila] = filaOriginal. Prefiere una que dé dominancia diagonal estricta.
 * Devuelve { perm, dominant } o null si no existe ninguna.
 */
export function findRowPermutation(A) {
  const n = A.length;

  // Una fila solo puede ser dominante en la columna de su mayor |aij|.
  const dom = new Array(n).fill(-1);
  const feasible = A.every((row, i) => {
    const abs = row.map(Math.abs);
    const total = abs.reduce((s, v) => s + v, 0);
    const c = abs.indexOf(Math.max(...abs));
    if (abs[c] <= total - abs[c] || dom[c] !== -1) return false;
    dom[c] = i;
    return true;
  });
  if (feasible) return { perm: dom, dominant: true };

  // Búsqueda con retroceso: diagonal sin ceros, probando primero los coeficientes más grandes.
  const rowSum = A.map((row) => row.reduce((s, a) => s + Math.abs(a), 0));
  const candidates = Array.from({ length: n }, (_, col) =>
    A.map((_, i) => i)
      .filter((i) => A[i][col] !== 0)
      .sort((p, q) => Math.abs(A[q][col]) / rowSum[q] - Math.abs(A[p][col]) / rowSum[p]),
  );
  const used = new Array(n).fill(false);
  const perm = new Array(n);
  const place = (col) => {
    if (col === n) return true;
    for (const i of candidates[col]) {
      if (used[i]) continue;
      used[i] = true;
      perm[col] = i;
      if (place(col + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  if (!place(0)) return null;
  return { perm, dominant: diagonalDominance(perm.map((i) => A[i])).strict };
}
