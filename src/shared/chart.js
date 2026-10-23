import { MINUS } from './format.js';

/* Utilidades de escala para los gráficos SVG (sin librerías). */

export function niceTicks(min, max, count = 6) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return { ticks, step };
}

export function tickLabel(v, step) {
  const d = Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  const s = (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(d);
  return s.replace('-', MINUS);
}
