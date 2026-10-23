/* =========================================================
   Método: diferencias divididas de Newton (sin dependencias de la interfaz)
   ========================================================= */

/** Tabla D[i][j]; D[i][0] = yi, D[i][j] = (D[i+1][j−1] − D[i][j−1]) / (x[i+j] − x[i]). */
export function dividedDifferences(xs, ys) {
  const n = xs.length;
  const D = xs.map((_, i) => {
    const row = new Array(n).fill(null);
    row[0] = ys[i];
    return row;
  });
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < n - j; i++) {
      D[i][j] = (D[i + 1][j - 1] - D[i][j - 1]) / (xs[i + j] - xs[i]);
    }
  }
  return D;
}

/** Evalúa la forma de Newton con el esquema anidado (Horner). */
export function evalNewton(coefs, xs, x) {
  let r = coefs[coefs.length - 1];
  for (let k = coefs.length - 2; k >= 0; k--) r = r * (x - xs[k]) + coefs[k];
  return r;
}

export function equidistance(xs) {
  if (xs.length < 3) return { equi: true, h: xs[1] - xs[0] };
  const h = xs[1] - xs[0];
  const tol = 1e-9 * Math.max(...xs.map(Math.abs), 1);
  const equi = xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - h) <= tol);
  return { equi, h };
}

/**
 * Polinomio de Newton por los nodos (xs, ys), evaluado en xEval.
 * Cada término k es a_k · Π_{l<k} (xEval − x_l); todo con precisión completa.
 */
export function newtonPolynomial(xs, ys, xEval) {
  const D = dividedDifferences(xs, ys);
  const coefs = D[0].slice();
  const terms = coefs.map((a, k) => {
    const diffs = xs.slice(0, k).map((xk) => xEval - xk);
    const prod = diffs.reduce((p, d) => p * d, 1);
    return { k, a, diffs, prod, value: a * prod };
  });
  return {
    m: xs.length - 1, xs, ys, D, coefs, terms,
    value: terms.reduce((s, t) => s + t.value, 0),
    extrapolation: xEval < Math.min(...xs) || xEval > Math.max(...xs),
  };
}

/** P_g para g = 1 … n − 1, cada uno con los primeros g + 1 puntos en el orden ingresado. */
export function newtonAllDegrees(points, xEval) {
  const degrees = [];
  for (let g = 1; g < points.length; g++) {
    const nodes = points.slice(0, g + 1);
    const poly = newtonPolynomial(nodes.map((p) => p.x), nodes.map((p) => p.y), xEval);
    const prev = degrees.length ? degrees[degrees.length - 1].value : null;
    degrees.push({ ...poly, g, change: prev === null ? null : Math.abs(poly.value - prev) });
  }
  return degrees;
}

export function solveNewton({ points, m, used, xEval, mode }) {
  const xs = used.map((i) => points[i].x);
  const ys = used.map((i) => points[i].y);
  const poly = newtonPolynomial(xs, ys, xEval);
  return {
    ...poly,
    points, n: points.length, m, used, mode, xEval,
    spacing: equidistance(xs),
    degrees: newtonAllDegrees(points, xEval),
  };
}
