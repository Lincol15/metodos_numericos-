/* =========================================================
   Gráficas con Chart.js.
   - Una sola instancia por lienzo: se destruye antes de recrear.
   - Las curvas se generan muestreando el polinomio (no uniendo nodos).
   - Controles para ampliar, reducir y restablecer el rango de x.
   ========================================================= */

import Chart from 'chart.js/auto';

const instances = new Map(); // id del lienzo → Chart

export const SAMPLES = 400;

export const PALETTE = ['#4f46e5', '#7c3aed', '#0891b2', '#db2777', '#059669', '#d97706', '#2563eb', '#9333ea'];

/** Muestras {x, y} de f en [a, b]; descarta valores no finitos. */
export function sampleCurve(f, a, b, samples = SAMPLES) {
  const pts = [];
  for (let k = 0; k <= samples; k++) {
    const x = a + ((b - a) * k) / samples;
    const y = f(x);
    pts.push({ x, y: Number.isFinite(y) ? y : null });
  }
  return pts;
}

/** Rango inicial que incluye todos los x dados con un margen. */
export function paddedRange(xs, pad = 0.08) {
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  return [lo - span * pad, hi + span * pad];
}

/** Límites de y a partir de los puntos importantes; las curvas pueden salirse (se recortan). */
function yLimits(points, curves) {
  const ys = points.filter(Number.isFinite);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  const cy = curves.flat().map((p) => p.y).filter(Number.isFinite);
  const cLo = Math.max(Math.min(...cy, lo), lo - 1.5 * span);
  const cHi = Math.min(Math.max(...cy, hi), hi + 1.5 * span);
  const s2 = cHi - cLo;
  return [cLo - s2 * 0.06, cHi + s2 * 0.06];
}

const numberTick = (v) => Number(v.toPrecision(6)).toString().replace('-', '−');

/**
 * Monta una gráfica en `container`.
 * build(xmin, xmax) → { datasets, keyY: number[] } (keyY: y que deben verse siempre).
 */
export function mountPlot(container, { id, build, baseRange, xLabel = 'x', yLabel = 'y', ariaLabel }) {
  container.innerHTML = `
    <div class="plot-toolbar" role="toolbar" aria-label="Controles del rango de la gráfica">
      <button type="button" class="btn btn-ghost btn-sm" data-zoom="out">Ampliar rango</button>
      <button type="button" class="btn btn-ghost btn-sm" data-zoom="in">Reducir rango</button>
      <button type="button" class="btn btn-ghost btn-sm" data-zoom="reset">Restablecer</button>
      <span class="hint small">Pulsa un elemento de la leyenda para ocultarlo o mostrarlo.</span>
    </div>
    <div class="plot-canvas"><canvas id="${id}" role="img" aria-label="${ariaLabel}"></canvas></div>`;

  let range = baseRange.slice();
  const canvas = container.querySelector('canvas');

  const draw = () => {
    const { datasets, keyY } = build(range[0], range[1]);
    const curves = datasets.filter((d) => d.isCurve).map((d) => d.data);
    const [ymin, ymax] = yLimits(keyY, curves);
    const hidden = new Map();
    const prev = instances.get(id);
    if (prev) {
      prev.data.datasets.forEach((d, i) => hidden.set(d.label, !prev.isDatasetVisible(i)));
      prev.destroy();
    }
    datasets.forEach((d) => { if (hidden.get(d.label)) d.hidden = true; });
    const chart = new Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: range[0], max: range[1], title: { display: true, text: xLabel }, ticks: { callback: numberTick, includeBounds: false } },
          y: { min: ymin, max: ymax, title: { display: true, text: yLabel }, ticks: { callback: numberTick, includeBounds: false } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: (${Number(ctx.parsed.x.toPrecision(8))}, ${Number(ctx.parsed.y.toPrecision(8))})`,
            },
          },
        },
      },
    });
    instances.set(id, chart);
  };

  container.querySelector('.plot-toolbar').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (!z) return;
    const mid = (range[0] + range[1]) / 2;
    const half = (range[1] - range[0]) / 2;
    if (z === 'out') range = [mid - half * 1.5, mid + half * 1.5];
    else if (z === 'in') range = [mid - half / 1.5, mid + half / 1.5];
    else range = baseRange.slice();
    draw();
  });

  draw();
}

/** Imagen PNG de una gráfica ya dibujada (para la vista imprimible). */
export const chartImage = (id) => instances.get(id)?.toBase64Image() ?? null;

/** Estilos de serie comunes. */
export const curveStyle = (label, color, data, extra = {}) => ({
  label, data, isCurve: true, showLine: true, pointRadius: 0, borderWidth: 2.5,
  borderColor: color, backgroundColor: color, spanGaps: false, ...extra,
});
export const pointStyle = (label, color, data, extra = {}) => ({
  label, data, showLine: false, pointRadius: 5, pointHoverRadius: 7,
  borderColor: color, backgroundColor: color, ...extra,
});
