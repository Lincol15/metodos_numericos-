/* =========================================================
   Regresión polinomial por mínimos cuadrados (funciones puras).

   Dos procedimientos:
   1. Didáctico: ecuaciones normales C·a = b e inversa por Gauss-Jordan.
   2. Estable: QR de Householder con x centrado y escalado, t = (x − c)/h.
      Es el que se usa para evaluar, graficar y obtener los coeficientes mostrados.
   ========================================================= */

import { gaussJordanInverse, householderLeastSquares, matVec } from './matrices.js';
import { sum, mean, pearson, distinctCount } from './statistics.js';

export const MIN_DEGREE = 1;
export const MAX_DEGREE = 8;

function binomial(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Errores de datos antes de calcular (mensajes en español). */
export function regressionPreconditions(xs, m) {
  const errors = [];
  if (!Number.isInteger(m) || m < MIN_DEGREE || m > MAX_DEGREE) errors.push(`El grado debe ser un entero entre ${MIN_DEGREE} y ${MAX_DEGREE}.`);
  if (xs.length < m + 1) errors.push(`Se necesitan al menos m + 1 = ${m + 1} datos para el grado ${m}; hay ${xs.length}.`);
  const d = distinctCount(xs);
  if (d < m + 1) errors.push(`Se necesitan al menos ${m + 1} valores distintos de x para el grado ${m}; hay ${d}.`);
  return errors;
}

/** Tabla de potencias y sumatorias: S_k = Σx^k (k = 0…2m), T_k = Σx^k·y (k = 0…m). */
export function powerSums(xs, ys, m) {
  const rows = xs.map((x, i) => {
    const pow = [1];
    for (let k = 1; k <= 2 * m; k++) pow.push(pow[k - 1] * x);
    return { x, y: ys[i], pow, powY: pow.slice(0, m + 1).map((p) => p * ys[i]) };
  });
  const S = Array.from({ length: 2 * m + 1 }, (_, k) => sum(rows.map((r) => r.pow[k])));
  const T = Array.from({ length: m + 1 }, (_, k) => sum(rows.map((r) => r.powY[k])));
  return { rows, S, T };
}

/** Ajuste estable por QR sobre t = (x − c)/h. */
export function stableFit(xs, ys, m) {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const c = (lo + hi) / 2;
  const h = (hi - lo) / 2 || 1;
  const X = xs.map((x) => {
    const t = (x - c) / h;
    const row = [1];
    for (let k = 1; k <= m; k++) row.push(row[k - 1] * t);
    return row;
  });
  const qr = householderLeastSquares(X, ys);
  if (!qr.ok) return { ok: false, reason: qr.reason };
  const beta = qr.beta;
  // Coeficientes en la variable original: a_j = Σ_{k≥j} β_k · h^(−k) · C(k, j) · (−c)^(k−j)
  const a = Array.from({ length: m + 1 }, (_, j) => {
    let s = 0;
    for (let k = j; k <= m; k++) s += beta[k] * h ** -k * binomial(k, j) * (-c) ** (k - j);
    return s;
  });
  const evaluate = (x) => {
    const t = (x - c) / h;
    let r = beta[m];
    for (let k = m - 1; k >= 0; k--) r = r * t + beta[k];
    return r;
  };
  if (!a.every(Number.isFinite)) return { ok: false, reason: 'Desbordamiento al convertir los coeficientes a la variable x original.' };
  return { ok: true, beta, center: c, halfWidth: h, a, evaluate };
}

/** Evalúa a0 + a1·x + … con Horner (coeficientes en x original). */
export const evalPower = (a, x) => a.reduceRight((r, ak) => r * x + ak, 0);

/**
 * Ajuste completo con todos los resultados intermedios para el desarrollo.
 * Lanza un Error con mensaje en español si los datos no permiten el ajuste.
 */
export function polynomialRegression(xs, ys, m, predictX = []) {
  const pre = regressionPreconditions(xs, m);
  if (pre.length) throw new Error(pre.join(' '));
  const n = xs.length;

  const sums = powerSums(xs, ys, m);
  if (![...sums.S, ...sums.T].every(Number.isFinite)) {
    throw new Error(`Desbordamiento: las potencias x^${2 * m} superan el rango representable. Usa valores de x de menor magnitud o un grado menor.`);
  }
  const C = Array.from({ length: m + 1 }, (_, p) => Array.from({ length: m + 1 }, (_, q) => sums.S[p + q]));
  const b = sums.T.slice();

  // Procedimiento didáctico: a = C⁻¹·b
  const gj = gaussJordanInverse(C);
  let normal = null;
  if (gj.ok) {
    const aN = matVec(gj.inverse, b);
    normal = aN.every(Number.isFinite) ? { a: aN, inverse: gj.inverse } : null;
  }

  // Procedimiento estable (resultado oficial)
  const fit = stableFit(xs, ys, m);
  if (!fit.ok) throw new Error(fit.reason);

  // Comparación entre ambos procedimientos sobre los valores ajustados
  let comparison = null;
  if (normal) {
    const yScale = Math.max(...ys.map(Math.abs), 1e-300);
    const fitDiff = Math.max(...xs.map((x) => Math.abs(evalPower(normal.a, x) - fit.evaluate(x)))) / yScale;
    const coefDiff = normal.a.map((v, j) => Math.abs(v - fit.a[j]));
    comparison = { fitDiff, coefDiff, agree: fitDiff <= 1e-6 };
  }

  // Residuos con la evaluación estable
  const fitted = xs.map((x) => fit.evaluate(x));
  const residuals = ys.map((y, i) => y - fitted[i]);
  const Sr = sum(residuals.map((e) => e * e));
  const dof = n - (m + 1);
  const s = dof > 0 ? Math.sqrt(Sr / dof) : null;

  const ybar = mean(ys);
  const St = sum(ys.map((y) => (y - ybar) ** 2));
  const R2 = St > 0 ? 1 - Sr / St : null;
  const R = R2 === null ? null : Math.sqrt(Math.max(0, R2));
  const corr = pearson(xs, ys);

  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const predictions = predictX.map((x) => {
    const terms = fit.a.map((ak, k) => ({ k, a: ak, pow: x ** k, value: ak * x ** k }));
    return {
      x, value: fit.evaluate(x), terms,
      termSum: sum(terms.map((t) => t.value)),
      extrapolation: x < xmin || x > xmax,
    };
  });

  return {
    n, m, xs, ys, sums, C, b, gj, normal, fit, comparison,
    fitted, residuals, Sr, dof, s, ybar, St, R2, R, corr,
    distinctX: distinctCount(xs) === n,
    range: [xmin, xmax], predictions,
  };
}
