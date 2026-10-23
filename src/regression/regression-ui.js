/* =========================================================
   Regresión polinomial: lectura de entradas, desarrollo y eventos.
   Los cálculos viven en src/math/regression.js.
   ========================================================= */

import { parseNumber, numberError, esc } from '../shared/format.js';
import { polynomialRegression, regressionPreconditions, MIN_DEGREE, MAX_DEGREE } from '../math/regression.js';
import { distinctCount } from '../math/statistics.js';
import { parseValueList } from '../utils/parsing.js';
import { copyText, downloadCSV, printReport, printableClone } from '../utils/export.js';
import { REGRESSION_EXAMPLE } from '../data/examples.js';
import { createPointEditor, createPasteImporter, pagedTable, expandAllPages } from '../ui/tables.js';
import { tex, texBlock, texNum, texIn, texParen, texSignedSum, texMatrix, texColumn, texPow, texMinus } from '../ui/formulas.js';
import { mountPlot, sampleCurve, paddedRange, curveStyle, pointStyle } from '../ui/charts.js';

const MAX_ROWS = 1000;
const DEFAULT_DECIMALS = 4;

const $ = (s) => document.querySelector(s);
const els = {
  input: $('#reg-input'),
  degree: $('#reg-degree'),
  degreeHint: $('#reg-degree-hint'),
  decimals: $('#reg-decimals'),
  predict: $('#reg-predict'),
  predictHint: $('#reg-predict-hint'),
  predictMsg: $('#reg-predict-msg'),
  formMsg: $('#reg-form-msg'),
  calc: $('#reg-calc'),
  example: $('#reg-example'),
  clear: $('#reg-clear'),
  results: $('#reg-results'),
};

const state = { result: null, stale: false };
let DEC = DEFAULT_DECIMALS;
const N = (v) => texNum(v, DEC); // número en LaTeX
const H = (v) => tex(N(v)); // número renderizado
const plain = (v) => (v === null || v === undefined ? '—' : Number.isFinite(v) ? texNum(v, DEC).replace(/\\times 10\^\{(-?\d+)\}/, 'e$1') : 'no finito');

const editor = createPointEditor($('#reg-points'), {
  prefix: 'reg', label: 'Datos (xᵢ, yᵢ)', maxRows: MAX_ROWS, initialRows: 5, startIndex: 1,
  onChange: () => { updateDegreeHint(); markStale(); },
});
const importer = createPasteImporter($('#reg-paste'), {
  prefix: 'reg', maxRows: MAX_ROWS,
  onImport: (rows) => { editor.setRows(rows); els.formMsg.textContent = ''; },
});

/* ---------------- Entradas ---------------- */

function updateDegreeHint() {
  const rows = editor.getRows();
  const xs = rows.map((r) => parseNumber(r.x).value).filter((v) => v !== undefined);
  const m = Number(els.degree.value);
  els.degreeHint.textContent = `Requiere n ≥ ${m + 1} y al menos ${m + 1} valores distintos de x. Ahora: n = ${rows.length}, x distintos válidos = ${distinctCount(xs)}.`;
}

function updatePredictHint() {
  const { values, errors, separator } = parseValueList(els.predict.value);
  if (!els.predict.value.trim()) {
    els.predictHint.textContent = 'Separa con punto y coma o saltos de línea (admiten coma decimal). La coma como separador solo con punto decimal.';
    return;
  }
  els.predictHint.textContent = `Se interpreta${separator ? ` (separador: ${separator})` : ''}: ${values.length ? values.join(' ; ') : 'ningún valor válido'}${errors.length ? ` · ${errors.length} con error` : ''}`;
}

function markStale() {
  if (!state.result || state.stale) return;
  state.stale = true;
  els.results.classList.add('is-stale');
  els.results.querySelectorAll('.export-btn').forEach((b) => (b.disabled = true));
  els.results.insertAdjacentHTML('afterbegin', staleBanner());
}
const staleBanner = () =>
  '<div class="stale-banner" role="status">Las entradas cambiaron. Estos resultados ya no son vigentes: presiona <strong>Calcular</strong> para actualizarlos. La exportación está desactivada.</div>';

function readInputs() {
  editor.clearErrors();
  els.predict.classList.remove('invalid');
  els.predictMsg.textContent = '';
  els.formMsg.textContent = '';

  const rows = editor.getRows();
  const xs = [];
  const ys = [];
  rows.forEach((r) => {
    const px = parseNumber(r.x);
    const py = parseNumber(r.y);
    if (numberError(px)) editor.setError(r.id, 'x', numberError(px, 'Requerido'));
    if (numberError(py)) editor.setError(r.id, 'y', numberError(py, 'Requerido'));
    xs.push(px.value);
    ys.push(py.value);
  });

  const m = Number(els.degree.value);
  const pred = parseValueList(els.predict.value);
  if (pred.errors.length) {
    els.predict.classList.add('invalid');
    els.predictMsg.textContent = `Valores no válidos: ${pred.errors.map((e) => `«${e.token}» (${e.message})`).join(', ')}`;
  }

  const errors = [];
  if (editor.firstError()) errors.push('Revisa los datos marcados en rojo. Los campos vacíos no se toman como cero.');
  if (pred.errors.length) errors.push('Corrige la lista de valores para predecir.');
  if (!errors.length) errors.push(...regressionPreconditions(xs, m));
  if (errors.length) {
    els.formMsg.innerHTML = errors.map(esc).join('<br>');
    (editor.firstError() ?? (pred.errors.length ? els.predict : null))?.focus();
    return null;
  }
  return { rows, xs, ys, m, predict: pred.values, predictText: els.predict.value.trim() };
}

function calculate() {
  const input = readInputs();
  if (!input) {
    if (state.result) markStale();
    return;
  }
  try {
    state.result = { ...polynomialRegression(input.xs, input.ys, input.m, input.predict), input };
  } catch (err) {
    state.result = null;
    els.formMsg.textContent = err.message;
    els.results.classList.remove('is-stale');
    els.results.innerHTML = `<article class="card step status-card status-error"><header class="step-head"><span class="step-num">!</span><h2>No se pudo calcular el ajuste</h2></header><p>${esc(err.message)}</p></article>`;
    return;
  }
  state.stale = false;
  render();
  if (window.matchMedia('(max-width: 979px)').matches) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- Presentación ---------------- */

const card = (num, title, body, { csv = null, extra = '' } = {}) => `
  <article class="card step ${extra}" id="reg-step-${num}">
    <header class="step-head"><span class="step-num">${num}</span><h2>${title}</h2>
      ${csv ? `<button type="button" class="btn btn-ghost btn-sm export-btn head-btn" data-csv="${csv}">Exportar CSV</button>` : ''}
    </header>
    ${body}
  </article>`;

/** Polinomio con coeficientes numéricos y signos fusionados. */
const polyTex = (a, m) =>
  `P_{${m}}(x) = ${texSignedSum(a.map((v, k) => ({ v, body: (abs) => `${N(abs)}${k ? texPow('x', k) : ''}` })))}`;
const polyGeneralTex = (m) =>
  `P_{${m}}(x) = ${Array.from({ length: m + 1 }, (_, k) => `a_{${k}}${texPow('x', k)}`).join(' + ')}`;

function render() {
  const r = state.result;
  DEC = Number(els.decimals.value);
  els.results.classList.toggle('is-stale', state.stale);
  els.results.innerHTML = [
    state.stale ? staleBanner() : '',
    renderSummary(r),
    `<article class="card step"><header class="step-head"><span class="step-num">≈</span><h2>Gráfica</h2></header><div id="reg-plot"></div></article>`,
    card(1, 'Tabla de sumatorias', renderSums(r), { csv: 'sums' }),
    card(2, 'Ecuaciones normales C·a = b', renderNormal(r)),
    card(3, 'Inversa de C por Gauss-Jordan', renderInverse(r)),
    card(4, 'Coeficientes del polinomio', renderCoefs(r), { csv: 'coefs' }),
    card(5, 'Residuos y error estándar', renderResiduals(r), { csv: 'residuals' }),
    card(6, 'Determinación y correlación', renderFit(r), { csv: 'deviations' }),
    card(7, 'Predicciones', renderPredictions(r), { csv: r.predictions.length ? 'predictions' : null }),
  ].join('');
  renderChart(r);
  if (state.stale) els.results.querySelectorAll('.export-btn').forEach((b) => (b.disabled = true));
}

function renderSummary(r) {
  const chips = [
    ['n', r.n], ['m', r.m],
    ['S<sub>r</sub>', plain(r.Sr)],
    ['s', r.s === null ? 'no definido' : plain(r.s)],
    ['R²', r.R2 === null ? 'no definido' : plain(r.R2)],
    ['r<sub>xy</sub>', r.corr.r === null ? 'no definido' : plain(r.corr.r)],
  ].map(([k, v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join('');
  const preds = r.predictions.map((p) => `<li>${tex(`P_{${r.m}}(${texIn(p.x)}) = ${N(p.value)}`)} <span class="tag ${p.extrapolation ? 'tag-warn' : 'tag-ok'}">${p.extrapolation ? 'Extrapolación' : 'Interpolación'}</span></li>`).join('');
  return `
    <div class="card summary-card">
      <div class="summary-head">
        <span class="status-pill status-ok-pill">Ajuste por mínimos cuadrados</span>
        <div class="toolbar">
          <button type="button" class="btn btn-ghost btn-sm export-btn" data-action="copy">Copiar resultados</button>
          <button type="button" class="btn btn-ghost btn-sm export-btn" data-action="print">Vista imprimible</button>
        </div>
      </div>
      ${texBlock(polyTex(r.fit.a, r.m))}
      <div class="metrics">${chips}</div>
      ${preds ? `<ul class="pred-list">${preds}</ul>` : ''}
      ${r.comparison && !r.comparison.agree ? '<p class="alert">Las ecuaciones normales y QR no coinciden; ver paso 4.</p>' : ''}
      <span class="copy-msg" role="status"></span>
    </div>`;
}

function renderChart(r) {
  const allX = [...r.xs, ...r.predictions.map((p) => p.x)];
  mountPlot(document.getElementById('reg-plot'), {
    id: 'reg-chart',
    baseRange: paddedRange(allX),
    ariaLabel: `Datos y polinomio de regresión de grado ${r.m}`,
    build: (a, b) => ({
      datasets: [
        pointStyle('Datos observados', '#334155', r.xs.map((x, i) => ({ x, y: r.ys[i] }))),
        curveStyle(`P${r.m}(x) ajustado`, '#4f46e5', sampleCurve(r.fit.evaluate, a, b)),
        ...(r.predictions.length ? [pointStyle('Predicciones', '#f59e0b', r.predictions.map((p) => ({ x: p.x, y: p.value })), { pointStyle: 'rectRot', pointRadius: 8 })] : []),
      ],
      keyY: [...r.ys, ...r.predictions.map((p) => p.value)],
    }),
  });
}

function sumsHeaders(m) {
  const h = ['i', 'x<sub>i</sub>', 'y<sub>i</sub>'];
  for (let k = 2; k <= 2 * m; k++) h.push(`x<sub>i</sub><sup>${k}</sup>`);
  for (let k = 1; k <= m; k++) h.push(`x<sub>i</sub>${k > 1 ? `<sup>${k}</sup>` : ''}·y<sub>i</sub>`);
  return h;
}
const sumsRow = (row, m) => [row.x, row.y, ...row.pow.slice(2, 2 * m + 1), ...row.powY.slice(1)];
const sumsFoot = (r) => [r.sums.S[1], r.sums.T[0], ...r.sums.S.slice(2), ...r.sums.T.slice(1)];

function renderSums(r) {
  const m = r.m;
  const rows = r.sums.rows.map((row, i) => [i + 1, ...sumsRow(row, m).map(plain)]);
  const list = [
    `S_0 = n = ${r.n}`,
    ...r.sums.S.slice(1).map((v, k) => `S_{${k + 1}} = \\textstyle\\sum x_i${k + 1 > 1 ? `^{${k + 1}}` : ''} = ${N(v)}`),
    ...r.sums.T.map((v, k) => `T_{${k}} = \\textstyle\\sum ${k ? `x_i${k > 1 ? `^{${k}}` : ''}` : ''}y_i = ${N(v)}`),
  ];
  return `
    <p class="note">Para m = ${m} se necesitan las potencias x<sub>i</sub><sup>k</sup> hasta k = 2m = ${2 * m} y los productos x<sub>i</sub><sup>k</sup>·y<sub>i</sub> hasta k = m = ${m}. La última fila contiene las sumatorias.</p>
    ${pagedTable({ headers: sumsHeaders(m), rows, foot: ['Σ', ...sumsFoot(r).map(plain)], cls: 'num-table' })}
    <div class="tex-grid">${list.map((s) => `<div>${tex(s)}</div>`).join('')}</div>`;
}

function renderNormal(r) {
  const m = r.m;
  const sym = (k) => (k === 0 ? 'n' : `\\sum x_i${k > 1 ? `^{${k}}` : ''}`);
  const symT = (k) => `\\sum ${k ? `x_i${k > 1 ? `^{${k}}` : ''}` : ''}y_i`;
  const general = Array.from({ length: m + 1 }, (_, p) =>
    `${Array.from({ length: m + 1 }, (_, q) => `a_{${q}}${sym(p + q)}`).join(' + ')} &= ${symT(p)}`).join(' \\\\ ');
  const subst = Array.from({ length: m + 1 }, (_, p) =>
    `${texSignedSum(r.C[p].map((v, q) => ({ v, body: (abs) => `${p + q === 0 ? texIn(abs) : N(abs)}\\,a_{${q}}` })))} &= ${N(r.b[p])}`).join(' \\\\ ');
  return `
    <p class="note">Al derivar S<sub>r</sub> = Σ[y<sub>i</sub> − P<sub>m</sub>(x<sub>i</sub>)]² respecto de cada a<sub>p</sub> e igualar a cero se obtienen m + 1 = ${m + 1} ecuaciones con C<sub>pq</sub> = Σx<sub>i</sub><sup>p+q</sup> y b<sub>p</sub> = Σx<sub>i</sub><sup>p</sup>y<sub>i</sub>.</p>
    <h3 class="sub-title">Forma general</h3>
    ${texBlock(`\\begin{aligned} ${general} \\end{aligned}`)}
    <h3 class="sub-title">Con los valores del ejercicio</h3>
    ${texBlock(`\\begin{aligned} ${subst} \\end{aligned}`)}
    <h3 class="sub-title">Forma matricial</h3>
    ${texBlock(`\\underbrace{${texMatrix(r.C.map((row) => row.map(N)))}}_{C} ${texColumn(r.C.map((_, k) => `a_{${k}}`))} = \\underbrace{${texColumn(r.b.map(N))}}_{b}`)}`;
}

function renderInverse(r) {
  const gj = r.gj;
  const n = r.m + 1;
  const aug = (M) => texMatrix(M.map((row) => row.map(N)), { split: n });
  const F = (i) => `F_{${i + 1}}`;
  const steps = gj.steps.map((s) => {
    const ops = [];
    if (s.swap) ops.push(`${F(s.swap.to)} \\leftrightarrow ${F(s.swap.from)}`);
    s.ops.forEach((o) => {
      if (o.type === 'normalize') ops.push(`${F(o.row)} \\leftarrow ${F(o.row)} \\div ${texParen(N(o.factor), o.factor)}`);
      else ops.push(`${F(o.row)} \\leftarrow ${texMinus(F(o.row), o.factor, (v) => `${N(v)}\\,`)}${F(s.col)}`);
    });
    return `
      <details class="gj-step" ${n <= 3 ? 'open' : ''}>
        <summary>Columna ${s.col + 1}: pivote ${tex(N(s.pivot))}${s.swap ? ` · intercambio de filas ${s.swap.from + 1} ↔ ${s.swap.to + 1}` : ''}</summary>
        <div class="gj-body">
          <ol class="op-list">${ops.map((o) => `<li>${tex(o)}</li>`).join('')}</ol>
          ${texBlock(aug(s.matrix))}
        </div>
      </details>`;
  }).join('');

  const head = `
    <p class="note">Se forma la matriz aumentada [C | I] y se aplican operaciones de fila hasta obtener [I | C⁻¹]. En cada columna se elige como pivote el elemento de mayor valor absoluto (pivoteo parcial); se acepta solo si supera la tolerancia ${tex(N(gj.pivotTol))} = n·ε·máx|C<sub>ij</sub>|, relativa a la escala de la matriz.</p>
    <h3 class="sub-title">Matriz aumentada inicial [C | I]</h3>
    ${texBlock(aug(gj.initial))}
    <div class="inline-actions no-print">
      <button type="button" class="btn btn-ghost btn-sm" data-action="gj-open">Expandir operaciones</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="gj-close">Contraer operaciones</button>
    </div>
    ${steps}`;

  if (!gj.ok) {
    return `${head}
      <p class="alert alert-error"><strong>No se obtuvo una inversa fiable.</strong> ${esc(gj.reason)} Por eso no se muestran C⁻¹ ni a = C⁻¹·b. El ajuste se resolvió con el método estable QR (paso 4).</p>`;
  }
  const condText = Number.isFinite(gj.cond) ? N(gj.cond) : '\\infty';
  return `${head}
    <h3 class="sub-title">Resultado [I | C⁻¹]</h3>
    ${texBlock(aug(gj.steps.at(-1).matrix))}
    ${texBlock(`C^{-1} = ${texMatrix(gj.inverse.map((row) => row.map(N)))}`)}
    <p class="note">Comprobación: ${tex(`\\lVert C\\,C^{-1} - I \\rVert_\\infty = ${N(gj.checkError)}`)}. Número de condición estimado ${tex(`\\kappa_\\infty(C) = \\lVert C\\rVert_\\infty \\lVert C^{-1}\\rVert_\\infty \\approx ${condText}`)}.</p>
    ${gj.reliable ? '' : '<p class="alert"><strong>Advertencia numérica:</strong> C está mal condicionada; la inversa calculada puede tener pocas cifras correctas. Por eso los resultados oficiales se obtienen con QR.</p>'}`;
}

function renderCoefs(r) {
  const m = r.m;
  let product = '';
  if (r.normal) {
    const inv = r.normal.inverse;
    product = Array.from({ length: m + 1 }, (_, p) => {
      const terms = inv[p].map((c, q) => `${texParen(N(c), c)}\\,${texParen(N(r.b[q]), r.b[q])}`).join(' + ');
      return texBlock(`a_{${p}} = \\sum_{q} (C^{-1})_{${p}q}\\, b_q = ${terms} = ${N(r.normal.a[p])}`);
    }).join('');
  }
  const cmp = r.comparison;
  const rows = r.fit.a.map((a, j) => [
    `a<sub>${j}</sub>`,
    r.normal ? H(r.normal.a[j]) : '—',
    H(a),
    r.normal ? H(cmp.coefDiff[j]) : '—',
  ]);
  let verdict;
  if (!r.normal) verdict = '<p class="alert">No hay resultado por C⁻¹·b (la inversa no fue fiable). Se usan los coeficientes obtenidos por QR.</p>';
  else if (cmp.agree) verdict = `<p class="alert alert-ok">Ambos procedimientos coinciden: la mayor diferencia relativa en los valores ajustados es ${tex(N(cmp.fitDiff))}.</p>`;
  else verdict = `<p class="alert alert-error"><strong>Discrepancia numérica relevante:</strong> los valores ajustados difieren hasta ${tex(N(cmp.fitDiff))} (relativo a máx|y<sub>i</sub>|). Las ecuaciones normales amplifican los errores de redondeo; los resultados válidos son los de QR. No deben tomarse ambos como iguales.</p>`;

  return `
    <h3 class="sub-title">Procedimiento didáctico: a = C⁻¹·b</h3>
    ${r.normal ? product : '<p class="note">No disponible porque no se obtuvo una inversa fiable.</p>'}
    <h3 class="sub-title">Procedimiento estable: QR de Householder</h3>
    <p class="note">Se resuelve el mismo problema de mínimos cuadrados con la matriz de diseño en la variable centrada y escalada
      ${tex(`t = \\dfrac{x - c}{h}`)}, con ${tex(`c = ${N(r.fit.center)}`)} y ${tex(`h = ${N(r.fit.halfWidth)}`)}, sin formar C. Luego los coeficientes se convierten a la variable x original. Esta representación es la que se usa para evaluar, predecir y graficar.</p>
    ${pagedTable({ headers: ['Coeficiente', 'C⁻¹·b', 'QR (usado)', '|Diferencia|'], rows })}
    ${verdict}
    <h3 class="sub-title">Polinomio</h3>
    ${texBlock(polyGeneralTex(m))}
    ${texBlock(polyTex(r.fit.a, m))}
    <p class="note">Los coeficientes se muestran redondeados a ${DEC} decimales; todos los cálculos usan la precisión completa.</p>`;
}

function renderResiduals(r) {
  const rows = r.xs.map((x, i) => [i + 1, plain(x), plain(r.ys[i]), plain(r.fitted[i]), plain(r.residuals[i]), plain(r.residuals[i] ** 2)]);
  let sText;
  if (r.dof > 0) {
    sText = texBlock(`s = \\sqrt{\\dfrac{S_r}{gl}} = \\sqrt{\\dfrac{${N(r.Sr)}}{${r.dof}}} = ${N(r.s)}`);
  } else {
    sText = `<p class="alert"><strong>Error estándar no definido: cero grados de libertad</strong> (n = m + 1 = ${r.n}).
      ${r.distinctX ? 'Como los x<sub>i</sub> son distintos, el polinomio interpola los datos: en aritmética exacta todos los residuos son 0. Los residuos que aparezcan son errores de redondeo, no error de ajuste.' : ''}</p>`;
  }
  return `
    <p class="note">P<sub>m</sub>(x<sub>i</sub>) se evalúa con la representación estable y la precisión completa.</p>
    ${pagedTable({ headers: ['i', 'x<sub>i</sub>', 'y<sub>i</sub>', 'P<sub>m</sub>(x<sub>i</sub>)', 'e<sub>i</sub> = y<sub>i</sub> − P<sub>m</sub>(x<sub>i</sub>)', 'e<sub>i</sub>²'], rows, foot: ['Σ', '', '', '', '', plain(r.Sr)], cls: 'num-table' })}
    ${texBlock(`S_r = \\sum e_i^2 = ${N(r.Sr)}, \\qquad gl = n - (m+1) = ${r.n} - ${r.m + 1} = ${r.dof}`)}
    ${sText}`;
}

function strength(r) {
  const a = Math.abs(r);
  if (a < 0.1) return 'muy débil o nula';
  if (a < 0.5) return 'débil';
  if (a < 0.8) return 'moderada';
  return 'fuerte';
}

function renderFit(r) {
  const c = r.corr;
  const rows = r.xs.map((x, i) => [i + 1, plain(x), plain(r.ys[i]), plain(c.dy[i]), plain(c.dy[i] ** 2), plain(c.dx[i]), plain(c.dx[i] ** 2), plain(c.dx[i] * c.dy[i])]);
  const r2Block = r.R2 === null
    ? '<p class="alert"><strong>R² no definido:</strong> S<sub>t</sub> = 0 porque todos los y<sub>i</sub> son iguales; no hay variabilidad que explicar.</p>'
    : `${texBlock(`R^2 = 1 - \\dfrac{S_r}{S_t} = 1 - \\dfrac{${N(r.Sr)}}{${N(r.St)}} = ${N(r.R2)}`)}
       <p class="interpret">El modelo explica aproximadamente el <strong>${(r.R2 * 100).toFixed(Math.min(DEC, 4))} %</strong> de la variabilidad observada de y en estos datos.</p>
       ${texBlock(`R = \\sqrt{R^2} = ${N(r.R)}`)}
       <p class="note"><strong>R múltiple del ajuste.</strong> Es no negativo y mide qué tan cerca están los valores ajustados de los observados; no indica una dirección directa o inversa. Un R² alto describe estos datos, no garantiza predicciones fiables fuera de ellos.</p>`;

  let pearsonText;
  if (c.r === null) {
    pearsonText = `<p class="alert"><strong>Correlación no definida:</strong> ${c.sxx === 0 ? 'x' : 'y'} tiene varianza cero.</p>`;
  } else {
    const dir = Math.abs(c.r) < 0.1 ? '' : c.r > 0 ? ' directa (cuando x aumenta, y tiende a aumentar)' : ' inversa (cuando x aumenta, y tiende a disminuir)';
    pearsonText = `${texBlock(`r_{xy} = \\dfrac{\\sum (x_i-\\bar x)(y_i-\\bar y)}{\\sqrt{\\sum (x_i-\\bar x)^2 \\sum (y_i-\\bar y)^2}} = \\dfrac{${N(c.sxy)}}{\\sqrt{${N(c.sxx)} \\cdot ${N(c.syy)}}} = ${N(c.r)}`)}
      <p class="interpret">Asociación lineal ${strength(c.r)}${dir}.${Math.abs(c.r) < 0.5 ? ' Un valor cercano a cero indica poca asociación <em>lineal</em>, aunque puede existir una relación curva.' : ''}</p>
      <p class="note">r<sub>xy</sub> describe solo la tendencia lineal entre x e y. No implica que el polinomio ajustado sea creciente o decreciente en todo el intervalo.</p>`;
  }

  return `
    ${texBlock(`\\bar y = \\dfrac{\\sum y_i}{n} = \\dfrac{${N(r.sums.T[0])}}{${r.n}} = ${N(r.ybar)}, \\qquad \\bar x = ${N(c.xbar)}`)}
    ${pagedTable({
      headers: ['i', 'x<sub>i</sub>', 'y<sub>i</sub>', 'y<sub>i</sub> − ȳ', '(y<sub>i</sub> − ȳ)²', 'x<sub>i</sub> − x̄', '(x<sub>i</sub> − x̄)²', '(x<sub>i</sub> − x̄)(y<sub>i</sub> − ȳ)'],
      rows, foot: ['Σ', '', '', '', plain(r.St), '', plain(c.sxx), plain(c.sxy)], cls: 'num-table',
    })}
    ${texBlock(`S_t = \\sum (y_i - \\bar y)^2 = ${N(r.St)}`)}
    <h3 class="sub-title">Coeficiente de determinación</h3>
    ${r2Block}
    <h3 class="sub-title">Correlación de Pearson entre x e y</h3>
    ${pearsonText}`;
}

function renderPredictions(r) {
  if (!r.predictions.length) return '<p class="note">No se ingresaron valores de x para predecir.</p>';
  const [lo, hi] = r.range;
  return r.predictions.map((p) => {
    const xs = texParen(texIn(p.x), p.x);
    const subst = p.terms.map((t) => (t.k === 0 ? N(t.a) : `${texParen(N(t.a), t.a)}\\,${t.k === 1 ? xs : `${xs}^{${t.k}}`}`)).join(' + ');
    const values = texSignedSum(p.terms.map((t) => ({ v: t.value, body: N })));
    const mismatch = Math.abs(p.termSum - p.value) > 1e-9 * Math.max(1, Math.abs(p.value));
    return `
      <div class="prediction">
        <div class="pred-head">${tex(`x = ${texIn(p.x)}`)}
          <span class="tag ${p.extrapolation ? 'tag-warn' : 'tag-ok'}">${p.extrapolation ? 'Extrapolación' : 'Interpolación'}</span></div>
        ${texBlock(`P_{${r.m}}(${texIn(p.x)}) = ${subst}`)}
        ${texBlock(`= ${values}`)}
        <div class="result-box compact"><div class="result-value">${tex(`P_{${r.m}}(${texIn(p.x)}) = ${N(p.value)}`)}</div></div>
        ${p.extrapolation
          ? `<p class="alert">x = ${texIn(p.x)} está fuera del rango observado [${texIn(lo)}, ${texIn(hi)}]: es una <strong>extrapolación</strong>. Su fiabilidad es menor porque el modelo no tiene datos que lo respalden en esa zona.</p>`
          : `<p class="note">x está dentro del rango observado [${texIn(lo)}, ${texIn(hi)}] (interpolación).</p>`}
        ${mismatch ? '<p class="note">La suma de los términos y el valor destacado difieren levemente: el valor destacado se calcula con la representación estable.</p>' : ''}
      </div>`;
  }).join('');
}

/* ---------------- Exportación ---------------- */

function csvFor(kind) {
  const r = state.result;
  const m = r.m;
  if (kind === 'sums') {
    const h = ['i', 'x', 'y'];
    for (let k = 2; k <= 2 * m; k++) h.push(`x^${k}`);
    for (let k = 1; k <= m; k++) h.push(k === 1 ? 'x*y' : `x^${k}*y`);
    return [h, [...r.sums.rows.map((row, i) => [i + 1, ...sumsRow(row, m)]), ['Suma', ...sumsFoot(r)]]];
  }
  if (kind === 'coefs') return [['coeficiente', 'C_inv_b', 'QR'], r.fit.a.map((a, j) => [`a${j}`, r.normal ? r.normal.a[j] : '', a])];
  if (kind === 'residuals') return [['i', 'x', 'y', 'P(x)', 'e', 'e^2'], r.xs.map((x, i) => [i + 1, x, r.ys[i], r.fitted[i], r.residuals[i], r.residuals[i] ** 2])];
  if (kind === 'deviations') {
    const c = r.corr;
    return [['i', 'x', 'y', 'y-ybar', '(y-ybar)^2', 'x-xbar', '(x-xbar)^2', '(x-xbar)(y-ybar)'], r.xs.map((x, i) => [i + 1, x, r.ys[i], c.dy[i], c.dy[i] ** 2, c.dx[i], c.dx[i] ** 2, c.dx[i] * c.dy[i]])];
  }
  return [['x', 'P(x)', 'tipo'], r.predictions.map((p) => [p.x, p.value, p.extrapolation ? 'extrapolación' : 'interpolación'])];
}

function resultText() {
  const r = state.result;
  const f = (v) => (v === null ? 'no definido' : plain(v));
  const lines = [
    'Laboratorio Numérico — Regresión polinomial por mínimos cuadrados',
    `Datos (n = ${r.n}):`,
    ...r.xs.map((x, i) => `  ${i + 1}\tx = ${x}\ty = ${r.ys[i]}`),
    `Grado m = ${r.m}`,
    `Coeficientes (QR): ${r.fit.a.map((a, j) => `a${j} = ${plain(a)}`).join(', ')}`,
    `Sr = ${f(r.Sr)}; gl = ${r.dof}; s = ${r.s === null ? 'no definido (gl = 0)' : f(r.s)}`,
    `R² = ${f(r.R2)}; R múltiple = ${f(r.R)}; r_xy = ${f(r.corr.r)}`,
    ...r.predictions.map((p) => `P${r.m}(${p.x}) = ${plain(p.value)} (${p.extrapolation ? 'extrapolación' : 'interpolación'})`),
  ];
  return lines.join('\n');
}

function printView() {
  const r = state.result;
  expandAllPages(els.results);
  const data = r.xs.map((x, i) => `<tr><td>${i + 1}</td><td>${x}</td><td>${r.ys[i]}</td></tr>`).join('');
  printReport(`
    <h1>Laboratorio Numérico — Regresión polinomial</h1>
    <h2>Datos</h2>
    <table class="data-table"><thead><tr><th>i</th><th>xi</th><th>yi</th></tr></thead><tbody>${data}</tbody></table>
    <h2>Configuración</h2>
    <p>Grado m = ${r.m} · n = ${r.n} · Decimales mostrados: ${DEC} · Predicciones: ${r.input.predictText || 'ninguna'}</p>
    <h2>Resultados</h2>
    ${printableClone(els.results)}`);
}

/* ---------------- Eventos ---------------- */

els.results.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn || !state.result) return;
  if (btn.dataset.csv) {
    if (state.stale) return;
    const [headers, rows] = csvFor(btn.dataset.csv);
    downloadCSV(`regresion-${btn.dataset.csv}.csv`, headers, rows);
  } else if (btn.dataset.action === 'copy' && !state.stale) {
    const ok = await copyText(resultText());
    const msg = els.results.querySelector('.copy-msg');
    if (msg) msg.textContent = ok ? 'Resultados copiados al portapapeles.' : 'No se pudo copiar.';
  } else if (btn.dataset.action === 'print' && !state.stale) {
    printView();
  } else if (btn.dataset.action === 'gj-open' || btn.dataset.action === 'gj-close') {
    els.results.querySelectorAll('.gj-step').forEach((d) => (d.open = btn.dataset.action === 'gj-open'));
  }
});

els.degree.addEventListener('change', () => { updateDegreeHint(); markStale(); });
els.predict.addEventListener('input', () => {
  updatePredictHint();
  els.predict.classList.remove('invalid');
  els.predictMsg.textContent = '';
  markStale();
});
els.decimals.addEventListener('change', () => state.result && render());
els.calc.addEventListener('click', calculate);

els.example.addEventListener('click', () => {
  editor.setRows(REGRESSION_EXAMPLE.points);
  els.degree.value = String(REGRESSION_EXAMPLE.degree);
  els.predict.value = REGRESSION_EXAMPLE.predict;
  updatePredictHint();
  updateDegreeHint();
  calculate();
});

els.clear.addEventListener('click', () => {
  state.result = null;
  state.stale = false;
  editor.reset(5);
  editor.clearErrors();
  importer.clear();
  els.degree.value = '2';
  els.predict.value = '';
  els.formMsg.textContent = '';
  els.predictMsg.textContent = '';
  updatePredictHint();
  updateDegreeHint();
  renderEmpty();
});

function renderEmpty() {
  els.results.classList.remove('is-stale');
  els.results.innerHTML = `
    <div class="card empty-state">
      <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M8 50 C24 46, 40 34, 56 12" /><circle cx="12" cy="44" r="3.5"/><circle cx="22" cy="48" r="3.5"/><circle cx="32" cy="36" r="3.5"/><circle cx="44" cy="30" r="3.5"/><circle cx="54" cy="14" r="3.5"/></svg></div>
      <h2>Aquí verás el ajuste y todo su desarrollo</h2>
      <p>Ingresa los datos (x<sub>i</sub>, y<sub>i</sub>), elige el grado m y presiona <strong>Calcular</strong>.</p>
      <ol class="empty-steps">
        <li>Tabla de sumatorias</li><li>Ecuaciones normales</li><li>Inversa por Gauss-Jordan</li><li>Coeficientes (C⁻¹b y QR)</li>
        <li>Residuos y error estándar</li><li>R², R y Pearson</li><li>Predicciones</li>
      </ol>
    </div>`;
}

/* ---------------- Inicio ---------------- */

els.degree.innerHTML = Array.from({ length: MAX_DEGREE - MIN_DEGREE + 1 }, (_, k) => `<option value="${k + MIN_DEGREE}">${k + MIN_DEGREE}</option>`).join('');
els.degree.value = '2';
els.decimals.innerHTML = Array.from({ length: 9 }, (_, k) => `<option value="${k + 2}">${k + 2}</option>`).join('');
els.decimals.value = String(DEFAULT_DECIMALS);
updateDegreeHint();
updatePredictHint();
renderEmpty();
