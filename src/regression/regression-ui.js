/* =========================================================
   Regresión polinomial: hoja de cálculo tipo Excel y cuadros de resultados.
   Se recalcula en cada edición; los cálculos viven en src/math/regression.js.
   ========================================================= */

import { parseNumber, formatNumber, esc } from '../shared/format.js';
import { polynomialRegression, regressionPreconditions, powerSums, MIN_DEGREE, MAX_DEGREE } from '../math/regression.js';
import { parseValueList } from '../utils/parsing.js';
import { downloadCSV, printReport, printableClone } from '../utils/export.js';
import { REGRESSION_EXAMPLE } from '../data/examples.js';
import { tex, texNum, texIn, texSignedSum, texMatrix, texColumn, texPow } from '../ui/formulas.js';
import { mountPlot, sampleCurve, paddedRange, curveStyle, pointStyle } from '../ui/charts.js';

const DECIMAL_OPTIONS = [2, 3, 4, 5, 6, 8];
const DEFAULT_DECIMALS = 4;
const DEFAULT_DEGREE = 2;
const EMPTY_ROWS = 3;
const MAX_ROWS = 1000;
const CURVE_SAMPLES = 200;

const $ = (s) => document.querySelector(s);
const els = {
  degree: $('#reg-degree'),
  n: $('#reg-n'),
  predict: $('#reg-predict'),
  predictHint: $('#reg-predict-hint'),
  decimals: $('#reg-decimals'),
  formMsg: $('#reg-form-msg'),
  example: $('#reg-example'),
  clear: $('#reg-clear'),
  sheet: $('#reg-sheet'),
  showFormulas: $('#reg-show-formulas'),
  addRow: $('#reg-add-row'),
  csv: $('#reg-csv'),
  print: $('#reg-print'),
  rowMsg: $('#reg-row-msg'),
  results: $('#reg-results'),
};

const emptyRows = (k) => Array.from({ length: k }, () => ({ x: '', y: '' }));
const state = { rows: emptyRows(EMPTY_ROWS), last: null };

let DEC = DEFAULT_DECIMALS;
const fmt = (v) => (v === null || v === undefined ? '—' : formatNumber(v, DEC));
const N = (v) => texNum(v, DEC);
const fmtPlain = (v) => String(v).replace('-', '−');
const degree = () => Number(els.degree.value);

/* ---------------- Columnas de la hoja ---------------- */

/** Columnas calculadas para el grado m: potencias, productos con y, residuo² y desviación². */
function computedColumns(m) {
  const cols = [];
  for (let k = 2; k <= 2 * m; k++) {
    cols.push({ key: `p${k}`, head: `x<sub>i</sub><sup>${k}</sup>`, csv: `xi^${k}`, formula: `=xi^${k}` });
  }
  for (let k = 1; k <= m; k++) {
    const xk = k === 1 ? 'x<sub>i</sub>' : `x<sub>i</sub><sup>${k}</sup>`;
    const xkText = k === 1 ? 'xi' : `xi^${k}`;
    cols.push({ key: `py${k}`, head: `${xk}·y<sub>i</sub>`, csv: `${xkText}*yi`, formula: `=${xkText}*yi` });
  }
  const poly = Array.from({ length: m + 1 }, (_, k) => (k === 0 ? 'a0' : k === 1 ? 'a1*xi' : `a${k}*xi^${k}`)).join('+');
  cols.push({ key: 'res', head: `(P<sub>${m}</sub>(x<sub>i</sub>) − y<sub>i</sub>)²`, csv: `(P${m}(xi)-yi)^2`, formula: `=(${poly}-yi)^2` });
  cols.push({ key: 'dev', head: '(y<sub>i</sub> − ȳ)²', csv: '(yi-media)^2', formula: '=(yi-media)^2' });
  return cols;
}

/** Construye toda la hoja. Solo se llama ante cambios de estructura (filas, grado, fórmulas). */
function buildSheet() {
  const m = degree();
  const cols = computedColumns(m);
  const formulaRow = els.showFormulas.checked
    ? `<tr class="formula-row"><td></td><td>dato</td><td>dato</td>${cols.map((c) => `<td>${esc(c.formula)}</td>`).join('')}<td></td></tr>`
    : '';
  const body = state.rows
    .map((r, i) => `
      <tr data-row="${i}">
        <td class="idx">${i + 1}</td>
        <td><input class="cell-input" data-row="${i}" data-field="x" value="${esc(r.x)}" inputmode="decimal" spellcheck="false" autocomplete="off" aria-label="x de la fila ${i + 1}"></td>
        <td><input class="cell-input" data-row="${i}" data-field="y" value="${esc(r.y)}" inputmode="decimal" spellcheck="false" autocomplete="off" aria-label="y de la fila ${i + 1}"></td>
        ${cols.map((c) => `<td class="calc" data-col="${c.key}"></td>`).join('')}
        <td><button type="button" class="icon-btn" data-del="${i}" aria-label="Eliminar fila ${i + 1}" ${state.rows.length === 1 ? 'disabled' : ''}>✕</button></td>
      </tr>`)
    .join('');
  els.sheet.innerHTML = `
    <thead>
      <tr><th>i</th><th>x<sub>i</sub></th><th>y<sub>i</sub></th>${cols.map((c) => `<th>${c.head}</th>`).join('')}<th><span class="sr-only">Eliminar</span></th></tr>
      ${formulaRow}
    </thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr><td>suma</td><td class="calc" data-sum="x"></td><td class="calc" data-sum="y"></td>${cols.map((c) => `<td class="calc" data-sum="${c.key}"></td>`).join('')}<td></td></tr>
    </tfoot>`;
  els.addRow.disabled = state.rows.length >= MAX_ROWS;
  update();
}

/* ---------------- Lectura de datos ---------------- */

/** Clasifica cada fila: vacía, válida o con celdas no válidas (no se usa). */
function readRows() {
  return state.rows.map((r) => {
    const px = parseNumber(r.x);
    const py = parseNumber(r.y);
    if (px.empty && py.empty) return { status: 'empty' };
    const bad = [];
    if (px.value === undefined) bad.push({ field: 'x', reason: px.empty ? 'falta x' : 'x no es numérico' });
    if (py.value === undefined) bad.push({ field: 'y', reason: py.empty ? 'falta y' : 'y no es numérico' });
    return bad.length ? { status: 'invalid', bad } : { status: 'ok', x: px.value, y: py.value };
  });
}

function readPredictions() {
  const { values, errors } = parseValueList(els.predict.value);
  els.predict.classList.toggle('invalid', errors.length > 0);
  if (errors.length) els.predictHint.textContent = `No se pudo leer: ${errors.map((e) => e.token).join(', ')}. Separa los valores con coma y usa punto decimal.`;
  else els.predictHint.textContent = values.length ? `Se evaluará en x = ${values.map(fmtPlain).join('; ')}` : '';
  return values;
}

/* ---------------- Cálculo y actualización ---------------- */

function update() {
  DEC = Number(els.decimals.value);
  const m = degree();
  const rows = readRows();
  const validIdx = rows.map((r, i) => (r.status === 'ok' ? i : -1)).filter((i) => i >= 0);
  const xs = validIdx.map((i) => rows[i].x);
  const ys = validIdx.map((i) => rows[i].y);
  const predictX = readPredictions();
  els.n.textContent = String(xs.length);

  // Marcas de validación sin reconstruir las celdas (el foco y el cursor se conservan)
  els.sheet.querySelectorAll('tbody tr').forEach((tr, i) => {
    const r = rows[i];
    tr.classList.toggle('row-invalid', r.status === 'invalid');
    tr.querySelectorAll('input[data-field]').forEach((inp) => {
      const bad = r.status === 'invalid' && r.bad.find((b) => b.field === inp.dataset.field);
      inp.classList.toggle('invalid', Boolean(bad));
      inp.title = bad ? `Esta fila no se usa: ${bad.reason}` : '';
    });
  });
  const unused = rows.map((r, i) => (r.status === 'invalid' ? `fila ${i + 1} (${r.bad.map((b) => b.reason).join(', ')})` : null)).filter(Boolean);
  els.rowMsg.textContent = unused.length ? `No se usan en el cálculo: ${unused.join('; ')}.` : '';

  // Ajuste
  let result = null;
  let message = '';
  if (!xs.length) {
    message = 'Ingresa los puntos (xᵢ, yᵢ) en la tabla o pulsa «Cargar ejemplo».';
  } else if (xs.length < m + 1) {
    message = `Con grado m = ${m} necesitas al menos ${m + 1} puntos válidos (hay ${xs.length}).`;
  } else {
    const pre = regressionPreconditions(xs, m);
    if (pre.length) message = pre.join(' ');
    else {
      try {
        result = polynomialRegression(xs, ys, m, predictX);
      } catch (err) {
        message = err.message;
      }
    }
  }
  els.formMsg.textContent = message;
  fillSheet(validIdx, xs, ys, m, result);
  state.last = result;
  if (result) renderResults(result);
  else renderEmpty(message);
}

/** Escribe los valores calculados en la hoja (precisión completa en el cálculo; se redondea al mostrar). */
function fillSheet(validIdx, xs, ys, m, r) {
  const cols = computedColumns(m);
  const sums = xs.length ? powerSums(xs, ys, m) : null;
  const ybar = ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : null;
  const pos = new Map(validIdx.map((i, k) => [i, k]));

  els.sheet.querySelectorAll('tbody tr').forEach((tr, i) => {
    const k = pos.get(i);
    cols.forEach((c) => {
      tr.querySelector(`[data-col="${c.key}"]`).innerHTML = k === undefined ? '' : fmt(cellValue(c.key, k, sums, ys, ybar, r));
    });
  });

  const foot = (key, html) => { els.sheet.querySelector(`[data-sum="${key}"]`).innerHTML = html; };
  foot('x', sums ? fmt(sums.S[1]) : '—');
  foot('y', sums ? fmt(sums.T[0]) : '—');
  cols.forEach((c) => {
    if (c.key === 'res') foot('res', r ? `<span class="sum-tag">S<sub>r</sub> =</span> ${fmt(r.Sr)}` : '—');
    else if (c.key === 'dev') foot('dev', ybar === null ? '—' : `<span class="sum-tag">S<sub>t</sub> =</span> ${fmt(ys.reduce((s, y) => s + (y - ybar) ** 2, 0))}`);
    else if (!sums) foot(c.key, '—');
    else if (c.key.startsWith('py')) foot(c.key, fmt(sums.T[Number(c.key.slice(2))]));
    else foot(c.key, fmt(sums.S[Number(c.key.slice(1))]));
  });
}

function cellValue(key, k, sums, ys, ybar, r) {
  const row = sums.rows[k];
  if (key.startsWith('py')) return row.powY[Number(key.slice(2))];
  if (key.startsWith('p')) return row.pow[Number(key.slice(1))];
  if (key === 'res') return r ? r.residuals[k] ** 2 : null;
  return (ys[k] - ybar) ** 2;
}

/* ---------------- Cuadros de resultados ---------------- */

function renderEmpty(message) {
  els.results.innerHTML = `
    <div class="card empty-state reg-wide">
      <h2>Aquí aparecerán los resultados</h2>
      <p>${esc(message || 'Completa la tabla para ver el ajuste.')}</p>
    </div>`;
}

const card = (num, title, body, cls = '') => `
  <article class="card step ${cls}" id="reg-card-${num}">
    <header class="step-head"><span class="step-num">${num}</span><h2>${title}</h2></header>
    ${body}
  </article>`;

/** Tabla etiqueta | fórmula | valor. */
const resTable = (rows) => `
  <div class="table-scroll"><table class="data-table res-table">
    <thead><tr><th>Etiqueta</th><th>Fórmula</th><th>Valor</th></tr></thead>
    <tbody>${rows.map(([label, formula, value]) => `<tr><th scope="row">${label}</th><td class="tex-cell">${formula}</td><td class="num-cell"><strong>${value}</strong></td></tr>`).join('')}</tbody>
  </table></div>`;

/** Coeficientes que se muestran: a = inv(C)·b; si perdió precisión se usa el ajuste estable. */
function displayedCoefs(r) {
  if (r.normal && r.comparison?.agree) return { a: r.normal.a, fromInverse: true };
  return { a: r.fit.a, fromInverse: false };
}

/** P_m(x) con los coeficientes numéricos y signos fusionados. */
function texPolynomial(a) {
  return texSignedSum(a.map((v, k) => ({ v, body: (abs) => `${N(abs)}${k === 0 ? '' : `\\cdot ${texPow('x', k)}`}` })));
}

function renderResults(r) {
  els.results.innerHTML = [
    card(1, 'Error estándar y media', renderStdError(r)),
    card(2, 'Coeficiente de determinación y de relación', renderDetermination(r)),
    card(3, 'Sistema de ecuaciones normales C · a = b', renderSystem(r)),
    card(4, 'inv(C)', renderInverse(r)),
    card(5, 'Coeficientes a y polinomio', renderCoefs(r)),
    card(6, 'Hallar y = ?', renderPredictions(r)),
    card(7, 'Gráfica', '<div id="reg-plot"></div>', 'reg-wide'),
  ].join('');
  renderChart(r);
}

function renderStdError(r) {
  const rows = [];
  if (r.dof > 0) {
    rows.push([
      'Error estándar',
      tex(`s = \\sqrt{\\dfrac{\\sum (P_{${r.m}}(x_i) - y_i)^2}{n - (m+1)}} = \\sqrt{\\dfrac{${N(r.Sr)}}{${r.n} - ${r.m + 1}}}`),
      fmt(r.s),
    ]);
  } else {
    rows.push(['Error estándar', tex('s = \\sqrt{\\dfrac{S_r}{n - (m+1)}}'), '—']);
  }
  rows.push(['Media', tex(`\\bar{y} = \\dfrac{\\sum y_i}{n} = \\dfrac{${N(r.sums.T[0])}}{${r.n}}`), fmt(r.ybar)]);
  const warn = r.dof > 0
    ? ''
    : `<p class="alert">Con n = m + 1 = ${r.n} puntos el polinomio pasa exactamente por todos los puntos; como n − (m + 1) = 0, el error estándar no se puede calcular.</p>`;
  return resTable(rows) + warn;
}

function strength(R) {
  if (R >= 0.9) return 'muy alta';
  if (R >= 0.7) return 'alta';
  if (R >= 0.5) return 'media';
  if (R >= 0.3) return 'baja';
  return 'muy baja';
}

function renderDetermination(r) {
  if (r.R2 === null) {
    return '<p class="alert">Todos los y<sub>i</sub> son iguales (S<sub>t</sub> = 0), así que r² no está definido.</p>';
  }
  const rows = [
    ['r²', tex(`r^2 = \\dfrac{S_t - S_r}{S_t} = \\dfrac{${N(r.St)} - ${N(r.Sr)}}{${N(r.St)}}`), fmt(r.R2)],
    ['r', tex(`r = \\sqrt{r^2} = \\sqrt{${N(r.R2)}}`), fmt(r.R)],
  ];
  const xbar = r.xs.reduce((s, v) => s + v, 0) / r.n;
  const cov = r.xs.reduce((s, x, i) => s + (x - xbar) * (r.ys[i] - r.ybar), 0);
  const direction = cov > 0 ? 'directa' : cov < 0 ? 'inversa' : 'sin tendencia lineal (covarianza nula)';
  return `${resTable(rows)}
    <p class="interpret">El ${(r.R2 * 100).toFixed(2)}% de la variabilidad de y en función de x está explicada por el modelo. La relación entre las variables es ${direction} y es ${strength(r.R)}.</p>`;
}

function renderSystem(r) {
  const C = r.C.map((row) => row.map((v) => texIn(v)));
  const aSym = Array.from({ length: r.m + 1 }, (_, k) => `a_{${k}}`);
  return `
    <div class="tex-block">${tex(`${texMatrix(C)} \\cdot ${texColumn(aSym)} = ${texColumn(r.b.map(N))}`, true)}</div>
    <p class="note">C es de ${r.m + 1}×${r.m + 1} con C<sub>ij</sub> = Σx<sub>k</sub><sup>i+j</sup> (i, j = 0 … ${r.m}); por eso C<sub>00</sub> = Σx<sup>0</sup> = n = ${r.n}. Cada b<sub>i</sub> = Σx<sub>k</sub><sup>i</sup>·y<sub>k</sub>. Todas las sumas salen de la fila «suma» de la tabla.</p>`;
}

function renderInverse(r) {
  if (!r.gj.ok) {
    return `<p class="alert alert-error">La matriz C es singular (o casi singular) y no tiene inversa. ${esc(r.gj.reason ?? '')} Revisa que haya al menos ${r.m + 1} valores distintos de x o usa un grado menor.</p>`;
  }
  const inv = r.gj.inverse.map((row) => row.map(N));
  const caution = r.gj.reliable === false && r.gj.reason ? `<p class="alert">${esc(r.gj.reason)}</p>` : '';
  return `
    <div class="tex-block">${tex(`C^{-1} = ${texMatrix(inv)}`, true)}</div>
    <p class="note">Calculada con Gauss-Jordan con pivoteo parcial. En Excel: MINVERSA (MINVERSE en inglés).</p>${caution}`;
}

function renderCoefs(r) {
  const { a, fromInverse } = displayedCoefs(r);
  const rows = a.map((v, k) => [`a<sub>${k}</sub>`, tex(`a_{${k}} = \\sum_{j=0}^{${r.m}} C^{-1}_{${k}j}\\, b_j`), fmt(v)]);
  const note = fromInverse
    ? ''
    : '<p class="alert">inv(C)·b perdió precisión con estos datos; los coeficientes mostrados provienen del ajuste estable (QR), que da el mismo modelo con más precisión.</p>';
  return `
    <div class="tex-block">${tex('a = C^{-1} \\cdot b', true)}</div>
    ${resTable(rows)}${note}
    <div class="poly-yellow">${tex(`P_{${r.m}}(x) = ${texPolynomial(a)}`)}</div>`;
}

function renderPredictions(r) {
  if (!r.predictions.length) {
    return '<p class="note">Escribe uno o más valores en «Hallar y = ? para x =», separados por coma, para evaluar el polinomio.</p>';
  }
  const { a } = displayedCoefs(r);
  const symbolic = texSignedSum(a.map((_, k) => ({ v: 1, body: () => `a_{${k}}${k === 0 ? '' : `\\cdot ${texPow('(x)', k)}`}` })));
  const rows = r.predictions
    .map((p) => {
      const xTex = texIn(p.x);
      const numeric = texSignedSum(a.map((v, k) => ({ v, body: (abs) => `${N(abs)}${k === 0 ? '' : `\\cdot ${texPow(`(${xTex})`, k)}`}` })));
      const tag = p.extrapolation ? ' <span class="tag tag-warn">Extrapolación</span>' : '';
      return `<tr>
        <td class="num-cell">${fmtPlain(p.x)}${tag}</td>
        <td class="num-cell cell-yellow"><strong>${fmt(p.value)}</strong></td>
        <td class="tex-cell">${tex(`P_{${r.m}}(${xTex}) = ${numeric} = ${N(p.value)}`)}</td>
      </tr>`;
    })
    .join('');
  const outside = r.predictions.filter((p) => p.extrapolation).map((p) => fmtPlain(p.x));
  const warn = outside.length
    ? `<p class="alert">x = ${outside.join(', ')} está fuera del rango de los datos [${fmtPlain(r.range[0])}, ${fmtPlain(r.range[1])}]: es una <strong>extrapolación</strong> y es menos fiable.</p>`
    : '';
  return `
    <p class="note">${tex(`P_{${r.m}}(x) = ${symbolic}`)}</p>
    <div class="table-scroll"><table class="data-table res-table">
      <thead><tr><th>x</th><th>P<sub>${r.m}</sub>(x)</th><th>Reemplazo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${warn}`;
}

function renderChart(r) {
  mountPlot(document.getElementById('reg-plot'), {
    id: 'reg-chart',
    baseRange: paddedRange([...r.xs, ...r.predictions.map((p) => p.x)]),
    ariaLabel: `Datos y polinomio de regresión de grado ${r.m}`,
    build: (lo, hi) => ({
      datasets: [
        pointStyle('Datos (xᵢ, yᵢ)', '#111a15', r.xs.map((x, i) => ({ x, y: r.ys[i] }))),
        curveStyle(`P${r.m}(x) ajustado`, '#0e8a45', sampleCurve(r.fit.evaluate, lo, hi, CURVE_SAMPLES)),
        ...(r.predictions.length
          ? [pointStyle('Predicciones', '#c27c12', r.predictions.map((p) => ({ x: p.x, y: p.value })), { pointStyle: 'rectRot', pointRadius: 8, pointHoverRadius: 10 })]
          : []),
      ],
      keyY: [...r.ys, ...r.predictions.map((p) => p.value)],
    }),
  });
}

/* ---------------- Pegado desde Excel ---------------- */

function pasteInto(rowIdx, field, text) {
  let lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // Encabezado: primera línea sin ningún número
  if (lines.length > 1 && lines[0].split('\t').every((c) => parseNumber(c).value === undefined)) lines = lines.slice(1);
  lines.forEach((line, k) => {
    const i = rowIdx + k;
    if (i >= MAX_ROWS) return;
    while (state.rows.length <= i) state.rows.push({ x: '', y: '' });
    const cells = line.split('\t').map((c) => c.trim());
    if (field === 'x') {
      state.rows[i].x = cells[0] ?? '';
      if (cells.length > 1) state.rows[i].y = cells[1];
    } else {
      state.rows[i].y = cells[0] ?? '';
    }
  });
  buildSheet();
  els.sheet.querySelector(`input[data-row="${rowIdx}"][data-field="${field}"]`)?.focus();
}

/* ---------------- Exportar e imprimir ---------------- */

function sheetMatrix() {
  const cols = computedColumns(degree());
  const text = (td) => td.textContent.replace(/S[rt] =\s*/, '').replace(/−/g, '-').trim();
  const headers = ['i', 'xi', 'yi', ...cols.map((c) => c.csv)];
  const rows = [...els.sheet.querySelectorAll('tbody tr')].map((tr, i) => [
    i + 1, state.rows[i].x, state.rows[i].y,
    ...cols.map((c) => text(tr.querySelector(`[data-col="${c.key}"]`))),
  ]);
  rows.push(['suma', ...[...els.sheet.querySelectorAll('tfoot [data-sum]')].map(text)]);
  return { headers, rows };
}

function printView() {
  const { headers, rows } = sheetMatrix();
  const table = `<table class="data-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  printReport(`
    <h1>Regresión polinomial</h1>
    <p>Grado m = ${degree()}, n = ${els.n.textContent}, ${DEC} decimales.</p>
    <h2>Tabla de cálculo</h2>
    <div class="table-scroll">${table}</div>
    <h2>Resultados</h2>
    ${state.last ? printableClone(els.results) : `<p>${esc(els.formMsg.textContent)}</p>`}`);
}

/* ---------------- Eventos ---------------- */

els.sheet.addEventListener('input', (e) => {
  const inp = e.target.closest('input[data-field]');
  if (!inp) return;
  state.rows[Number(inp.dataset.row)][inp.dataset.field] = inp.value;
  update();
});

els.sheet.addEventListener('paste', (e) => {
  const inp = e.target.closest('input[data-field]');
  const text = e.clipboardData?.getData('text') ?? '';
  if (!inp || !/[\t\n]/.test(text.trim())) return; // un solo valor: pegado normal
  e.preventDefault();
  pasteInto(Number(inp.dataset.row), inp.dataset.field, text);
});

els.sheet.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn || state.rows.length === 1) return;
  state.rows.splice(Number(btn.dataset.del), 1);
  buildSheet();
});

els.addRow.addEventListener('click', () => {
  if (state.rows.length >= MAX_ROWS) return;
  state.rows.push({ x: '', y: '' });
  buildSheet();
  els.sheet.querySelector(`input[data-row="${state.rows.length - 1}"][data-field="x"]`)?.focus();
});

els.degree.addEventListener('change', buildSheet);
els.showFormulas.addEventListener('change', buildSheet);
els.decimals.addEventListener('change', update);
els.predict.addEventListener('input', update);

els.example.addEventListener('click', () => {
  state.rows = REGRESSION_EXAMPLE.points.map((p) => ({ x: p.x, y: p.y }));
  els.degree.value = String(REGRESSION_EXAMPLE.degree);
  els.predict.value = REGRESSION_EXAMPLE.predict;
  buildSheet();
});

els.clear.addEventListener('click', () => {
  state.rows = emptyRows(EMPTY_ROWS);
  els.predict.value = '';
  buildSheet();
});

els.csv.addEventListener('click', () => {
  const { headers, rows } = sheetMatrix();
  downloadCSV('regresion-tabla.csv', headers, rows);
});
els.print.addEventListener('click', printView);

/* ---------------- Inicio ---------------- */

els.degree.innerHTML = Array.from({ length: MAX_DEGREE - MIN_DEGREE + 1 }, (_, k) => `<option value="${k + MIN_DEGREE}">${k + MIN_DEGREE}</option>`).join('');
els.degree.value = String(DEFAULT_DEGREE);
els.decimals.innerHTML = DECIMAL_OPTIONS.map((d) => `<option value="${d}">${d}</option>`).join('');
els.decimals.value = String(DEFAULT_DECIMALS);
buildSheet();
