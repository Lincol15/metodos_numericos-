/* =========================================================
   Interpolación de Lagrange (funciones puras).
   Forma clásica para la explicación y forma baricéntrica para evaluar.
   ========================================================= */

const EPS = Number.EPSILON;

/**
 * Selección automática de g+1 nodos: los más cercanos al objetivo.
 * Empates de distancia (con tolerancia relativa) → menor xi primero.
 * Devuelve los índices ordenados por xi ascendente.
 */
export function selectNearestNodes(xs, target, count) {
  const scale = Math.max(1, Math.abs(target), ...xs.map(Math.abs));
  const tieTol = 1e-12 * scale;
  const order = xs
    .map((x, i) => ({ i, x, d: Math.abs(x - target) }))
    .sort((p, q) => (Math.abs(p.d - q.d) <= tieTol ? p.x - q.x : p.d - q.d));
  return order
    .slice(0, count)
    .sort((p, q) => p.x - q.x)
    .map((p) => p.i);
}

/** Funciones base Li(x) con todos los factores para el desarrollo. */
export function lagrangeBases(nx, x) {
  return nx.map((xi, i) => {
    const factors = nx
      .map((xj, j) => ({ j, xj, num: x - xj, den: xi - xj }))
      .filter((f) => f.j !== i);
    const num = factors.reduce((p, f) => p * f.num, 1);
    const den = factors.reduce((p, f) => p * f.den, 1);
    return { i, xi, factors, num, den, L: num / den };
  });
}

/** Pesos baricéntricos w_i = 1 / Π_{j≠i}(xi − xj). */
export function barycentricWeights(nx) {
  return nx.map((xi, i) => 1 / nx.reduce((p, xj, j) => (j === i ? p : p * (xi - xj)), 1));
}

/** Evaluación baricéntrica (segunda forma). Si x coincide con un nodo devuelve su yi. */
export function barycentricEval(nx, ny, w, x) {
  const scale = Math.max(1, ...nx.map(Math.abs));
  let numer = 0;
  let denom = 0;
  for (let i = 0; i < nx.length; i++) {
    const d = x - nx[i];
    if (d === 0 || Math.abs(d) <= 4 * EPS * scale) return ny[i];
    const t = w[i] / d;
    numer += t * ny[i];
    denom += t;
  }
  return numer / denom;
}

/** Interpolación completa para un conjunto de nodos ya elegido. */
export function lagrangeInterpolation(nx, ny, x) {
  const bases = lagrangeBases(nx, x);
  const contributions = bases.map((b, i) => ({ ...b, y: ny[i], term: ny[i] * b.L }));
  const classic = contributions.reduce((s, c) => s + c.term, 0);
  const w = barycentricWeights(nx);
  const bary = barycentricEval(nx, ny, w, x);
  const sumL = bases.reduce((s, b) => s + b.L, 0);

  const yScale = Math.max(1, ...ny.map(Math.abs));
  const tol = 1e-9 * yScale;
  const finite = [classic, bary, sumL, ...w].every(Number.isFinite);
  const agree = finite && Math.abs(classic - bary) <= tol;
  const sumOk = finite && Math.abs(sumL - 1) <= 1e-9 * Math.max(1, ...bases.map((b) => Math.abs(b.L)));

  // Reproducción de los nodos con la forma clásica
  const reproduction = nx.map((xi, i) => {
    const v = lagrangeBases(nx, xi).reduce((s, b, k) => s + ny[k] * b.L, 0);
    return { x: xi, y: ny[i], value: v, diff: Math.abs(v - ny[i]), ok: Math.abs(v - ny[i]) <= tol };
  });

  const nodeHit = nx.findIndex((xi) => xi === x);
  return {
    x, nx, ny, contributions, classic, bary, w, sumL, finite, agree, sumOk, tol,
    reproduction, nodeHit,
    value: bary,
    extrapolation: x < Math.min(...nx) || x > Math.max(...nx),
  };
}

/** Evaluador de un solo polinomio (nodos fijos) para graficar toda su curva. */
export function makeInterpolant(nx, ny) {
  const w = barycentricWeights(nx);
  return (x) => barycentricEval(nx, ny, w, x);
}
