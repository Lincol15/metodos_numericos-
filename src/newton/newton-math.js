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

export function solveNewton({ points, m, used, xEval, mode, compare }) {
  const xs = used.map((i) => points[i].x);
  const ys = used.map((i) => points[i].y);
  const D = dividedDifferences(xs, ys);
  const coefs = D[0].slice();

  const terms = coefs.map((a, k) => {
    const diffs = xs.slice(0, k).map((xk) => xEval - xk);
    const prod = diffs.reduce((p, d) => p * d, 1);
    return { k, a, diffs, prod, value: a * prod };
  });
  const value = terms.reduce((s, t) => s + t.value, 0);

  let comparison = null;
  if (compare) {
    comparison = [];
    for (let g = 1; g < points.length; g++) {
      const gx = points.slice(0, g + 1).map((p) => p.x);
      const gy = points.slice(0, g + 1).map((p) => p.y);
      const gD = dividedDifferences(gx, gy);
      const v = evalNewton(gD[0], gx, xEval);
      const prev = comparison.length ? comparison[comparison.length - 1].value : null;
      comparison.push({ g, xs: gx, value: v, change: prev === null ? null : Math.abs(v - prev) });
    }
  }

  return {
    points, n: points.length, m, used, mode, xEval,
    xs, ys, D, coefs, terms, value,
    spacing: equidistance(xs),
    extrapolation: xEval < Math.min(...xs) || xEval > Math.max(...xs),
    comparison,
  };
}
