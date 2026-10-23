/* Estadística descriptiva básica (funciones puras). */

export const sum = (v) => v.reduce((s, x) => s + x, 0);
export const mean = (v) => sum(v) / v.length;

/**
 * Correlación de Pearson entre x e y con todos los términos intermedios.
 * r = null si alguna variable tiene varianza cero.
 */
export function pearson(xs, ys) {
  const xbar = mean(xs);
  const ybar = mean(ys);
  const dx = xs.map((x) => x - xbar);
  const dy = ys.map((y) => y - ybar);
  const sxy = sum(dx.map((d, i) => d * dy[i]));
  const sxx = sum(dx.map((d) => d * d));
  const syy = sum(dy.map((d) => d * d));
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  return { xbar, ybar, dx, dy, sxy, sxx, syy, r: r === null ? null : Math.max(-1, Math.min(1, r)) };
}

/** Cantidad de valores distintos (comparación exacta). */
export const distinctCount = (v) => new Set(v).size;
