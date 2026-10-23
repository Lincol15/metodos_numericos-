/* =========================================================
   Álgebra lineal básica: Gauss-Jordan con pivoteo parcial y QR de Householder.
   Funciones puras, sin dependencias de la interfaz.
   ========================================================= */

const EPS = Number.EPSILON;

export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const matVec = (M, v) => M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
export const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
export const maxAbs = (M) => M.reduce((m, row) => Math.max(m, ...row.map(Math.abs)), 0);
/** Norma infinito de una matriz: máxima suma de valores absolutos por fila. */
export const matNormInf = (M) => M.reduce((m, row) => Math.max(m, row.reduce((s, a) => s + Math.abs(a), 0)), 0);
const allFinite = (M) => M.every((row) => row.every(Number.isFinite));
const snapshot = (M) => M.map((row) => row.slice());

/**
 * Inversa por Gauss-Jordan sobre [C | I] con pivoteo parcial.
 * Registra cada operación para el desarrollo paso a paso.
 *
 * Devuelve { ok, inverse, steps, initial, pivotTol, cond, checkError, reliable, reason }.
 * steps: por columna { col, swap: {from, to} | null, pivot, ops: [{ type, row, factor }], matrix }.
 */
export function gaussJordanInverse(C) {
  const n = C.length;
  const scale = maxAbs(C);
  const pivotTol = n * EPS * scale; // tolerancia relativa a la escala de la matriz
  const M = C.map((row, i) => [...row, ...identity(n)[i]]);
  const initial = snapshot(M);
  const steps = [];

  if (scale === 0 || !Number.isFinite(scale)) {
    return { ok: false, initial, steps, pivotTol, reason: 'La matriz es nula o contiene valores no finitos.' };
  }

  for (let col = 0; col < n; col++) {
    // Pivoteo parcial: mayor |valor| de la columna desde la fila actual
    let best = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[best][col])) best = r;
    const pivot = M[best][col];
    if (!(Math.abs(pivot) > pivotTol)) {
      return {
        ok: false, initial, steps, pivotTol, failedCol: col,
        reason: `En la columna ${col + 1} el mayor pivote disponible (|${pivot.toExponential(3)}|) no supera la tolerancia ${pivotTol.toExponential(3)}, relativa a la escala de la matriz. La matriz es singular o está tan mal condicionada que su inversa no es fiable.`,
      };
    }
    const step = { col, swap: null, pivot, ops: [], matrix: null };
    if (best !== col) {
      [M[best], M[col]] = [M[col], M[best]];
      step.swap = { from: best, to: col };
    }
    // Normalización del pivote
    const p = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= p;
    M[col][col] = 1;
    step.ops.push({ type: 'normalize', row: col, factor: p });
    // Eliminación en las demás filas
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
      M[r][col] = 0;
      step.ops.push({ type: 'eliminate', row: r, factor: f });
    }
    step.matrix = snapshot(M);
    steps.push(step);
    if (!allFinite(M)) {
      return { ok: false, initial, steps, pivotTol, reason: 'Se produjo un desbordamiento numérico durante la eliminación.' };
    }
  }

  const inverse = M.map((row) => row.slice(n));
  const cond = matNormInf(C) * matNormInf(inverse);
  // Comprobación: ‖C·C⁻¹ − I‖∞
  const prod = matMul(C, inverse);
  const checkError = matNormInf(prod.map((row, i) => row.map((v, j) => v - (i === j ? 1 : 0))));
  const reliable = Number.isFinite(cond) && cond * EPS < 1e-4 && checkError < 1e-6;
  return { ok: true, inverse, initial, steps, pivotTol, cond, checkError, reliable };
}

/**
 * Mínimos cuadrados por QR de Householder: minimiza ‖Xβ − y‖₂.
 * Devuelve { ok, beta, rank, reason }.
 */
export function householderLeastSquares(X, y) {
  const n = X.length;
  const p = X[0].length;
  const A = X.map((row) => row.slice());
  const b = y.slice();
  const diag = [];

  for (let k = 0; k < p; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm = Math.hypot(norm, A[i][k]);
    if (norm === 0) {
      diag.push(0);
      continue;
    }
    const alpha = A[k][k] > 0 ? -norm : norm;
    const v = new Array(n).fill(0);
    v[k] = A[k][k] - alpha;
    for (let i = k + 1; i < n; i++) v[i] = A[i][k];
    let vv = 0;
    for (let i = k; i < n; i++) vv += v[i] * v[i];
    if (vv > 0) {
      for (let j = k; j < p; j++) {
        let s = 0;
        for (let i = k; i < n; i++) s += v[i] * A[i][j];
        const f = (2 * s) / vv;
        for (let i = k; i < n; i++) A[i][j] -= f * v[i];
      }
      let s = 0;
      for (let i = k; i < n; i++) s += v[i] * b[i];
      const f = (2 * s) / vv;
      for (let i = k; i < n; i++) b[i] -= f * v[i];
    }
    diag.push(A[k][k]);
  }

  const dmax = Math.max(...diag.map(Math.abs));
  const tol = Math.max(n, p) * EPS * dmax * 10;
  const rank = diag.filter((d) => Math.abs(d) > tol).length;
  if (rank < p) {
    return { ok: false, rank, reason: 'La matriz de diseño no tiene rango completo: los datos no determinan un único polinomio de este grado.' };
  }
  const beta = new Array(p).fill(0);
  for (let k = p - 1; k >= 0; k--) {
    let s = b[k];
    for (let j = k + 1; j < p; j++) s -= A[k][j] * beta[j];
    beta[k] = s / A[k][k];
  }
  if (!beta.every(Number.isFinite)) return { ok: false, rank, reason: 'Desbordamiento numérico al resolver el sistema triangular.' };
  return { ok: true, beta, rank };
}
