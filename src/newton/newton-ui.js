import { MINUS, parseNumber, splitPasted, formatNumber, formatInput, signedSum, frac, esc, toSub } from '../shared/format.js';
import { niceTicks, tickLabel } from '../shared/chart.js';
import { evalNewton, solveNewton } from './newton-math.js';
import { downloadCSV, printReport, printableClone } from '../utils/export.js';

/* =========================================================
   Configuración y estado
   ========================================================= */
const MIN_POINTS = 2;
const MAX_POINTS = 20;
const DEFAULT_ROWS = 4;
const DEFAULT_DECIMALS = 6;

// Solo para demostración: el algoritmo no depende de estos datos.
const EXAMPLE = {
  points: [
    ['1.0', '0.7651977'],
    ['1.3', '0.6200860'],
    ['1.6', '0.4554022'],
    ['1.9', '0.2818186'],
    ['2.2', '0.1103623'],
  ],
  x: '1.5',
};

const state = {
  rows: [], // { x: string, y: string, use: boolean }
  degreeTouched: false,
  solution: null,
};

let DEC = DEFAULT_DECIMALS; // decimales vigentes para la presentación

const $ = (sel) => document.querySelector(sel);
const els = {
  table: $('#points-table'),
  body: $('#points-body'),
  count: $('#points-count'),
  addRow: $('#add-row'),
  pasteArea: $('#paste-area'),
  pasteApply: $('#paste-apply'),
  pasteMsg: $('#paste-msg'),
  xEval: $('#x-eval'),
  xEvalMsg: $('#x-eval-msg'),
  degree: $('#degree'),
  degreeHint: $('#degree-hint'),
  decimals: $('#decimals'),
  selFirst: $('#sel-first'),
  selManual: $('#sel-manual'),
  selHint: $('#selection-hint'),
  formMsg: $('#form-msg'),
  calc: $('#btn-calc'),
  example: $('#btn-example'),
  clear: $('#btn-clear'),
  results: $('#results'),
};

/* =========================================================
   Datos pegados desde Excel
   ========================================================= */

/** Convierte texto copiado de Excel en filas [x, y]. */
function parsePasted(text) {
  let rows = splitPasted(text);
  const notes = [];

  // Encabezado: primera fila sin números válidos
  if (rows.length && rows[0].every((c) => parseNumber(c).value === undefined)) {
    rows = rows.slice(1);
    notes.push('se omitió la fila de encabezado');
  }
  // Columna de índice i (0,1,2… o 1,2,3…) seguida de x, y
  if (rows.length && rows.every((r) => r.length >= 3)) {
    const first = rows.map((r) => parseNumber(r[0]).value);
    const start = first[0];
    if ((start === 0 || start === 1) && first.every((v, k) => v === start + k)) {
      rows = rows.map((r) => r.slice(1));
      notes.push('se omitió la columna i');
    }
  }
  return { rows: rows.map((r) => [r[0] ?? '', r[1] ?? '']), notes };
}

/* =========================================================
   Formato de presentación (el cálculo nunca se redondea)
   ========================================================= */

const fmt = (v, dec = DEC) => formatNumber(v, dec);
const fmtIn = formatInput;

/** Envuelve en paréntesis si es negativo. */
const paren = (v, f = fmt) => (v < 0 ? `(${f(v)})` : f(v));

/** "a − b" fusionando signos: a − (−b) → a + b. */
const minus = (aHTML, b, f = fmt) => (b < 0 ? `${aHTML} + ${f(-b)}` : `${aHTML} ${MINUS} ${f(b)}`);

const xv = (i) => `<var>x</var><sub>${i}</sub>`;

function ddLabel(i, j) {
  if (j === 0) return `f[${xv(i)}]`;
  if (j <= 3) return `f[${Array.from({ length: j + 1 }, (_, k) => xv(i + k)).join(', ')}]`;
  return `f[${xv(i)}, ${xv(i + 1)}, …, ${xv(i + j)}]`;
}

/** Etiqueta con índice genérico i: f[xi], f[xi, xi+1], … */
function ddLabelGeneric(j) {
  const idx = (k) => `<var>x</var><sub>${k === 0 ? 'i' : `i+${k}`}</sub>`;
  if (j === 0) return `f[${idx(0)}]`;
  if (j <= 2) return `f[${Array.from({ length: j + 1 }, (_, k) => idx(k)).join(', ')}]`;
  return `f[${idx(0)}, …, ${idx(j)}]`;
}

/** Factor (x − xk) con signo correcto. */
function factorHTML(xk) {
  if (xk === 0) return '<var>x</var>';
  return `(<var>x</var> ${xk < 0 ? '+' : MINUS} ${fmtIn(Math.abs(xk))})`;
}

/* =========================================================
   Tabla de entrada
   ========================================================= */

const emptyRow = () => ({ x: '', y: '', use: false });

function renderRows() {
  const n = state.rows.length;
  els.body.innerHTML = state.rows
    .map(
      (r, i) => `
      <tr>
        <td class="col-i">${i}</td>
        <td>
          <input class="cell-input" data-field="x" data-row="${i}" inputmode="decimal" autocomplete="off"
            aria-label="x${i}" value="${esc(r.x)}" />
          <div class="field-msg" id="msg-x-${i}"></div>
        </td>
        <td>
          <input class="cell-input" data-field="y" data-row="${i}" inputmode="decimal" autocomplete="off"
            aria-label="f(x${i})" value="${esc(r.y)}" />
          <div class="field-msg" id="msg-y-${i}"></div>
        </td>
        <td class="col-use">
          <input type="checkbox" data-field="use" data-row="${i}" ${r.use ? 'checked' : ''} aria-label="Usar punto ${i}" />
        </td>
        <td class="col-del">
          <button type="button" class="icon-btn" data-action="delete" data-row="${i}"
            ${n <= MIN_POINTS ? 'disabled' : ''} title="Eliminar fila ${i}" aria-label="Eliminar fila ${i}">✕</button>
        </td>
      </tr>`,
    )
    .join('');

  els.count.textContent = `${n} / ${MAX_POINTS} puntos`;
  els.count.classList.toggle('warn', n >= MAX_POINTS);
  els.addRow.disabled = n >= MAX_POINTS;
  els.addRow.title = n >= MAX_POINTS ? `Máximo ${MAX_POINTS} puntos` : '';
  updateDegreeOptions();
  updateSelectionHint();
}

/** Todos los grados de 1 a MAX_POINTS − 1; sin elección del usuario se propone n − 1. */
function updateDegreeOptions() {
  const prev = Number(els.degree.value);
  if (els.degree.options.length !== MAX_POINTS - 1) {
    els.degree.innerHTML = Array.from({ length: MAX_POINTS - 1 }, (_, k) => `<option value="${k + 1}">${k + 1}</option>`).join('');
  }
  els.degree.value = String(state.degreeTouched && prev >= 1 ? prev : state.rows.length - 1);
  updateDegreeHint();
}

function updateDegreeHint() {
  const n = state.rows.length;
  const m = Number(els.degree.value);
  const missing = m + 1 > n ? ` <strong>${m + 1 - n === 1 ? 'Falta 1 fila' : `Faltan ${m + 1 - n} filas`}.</strong>` : '';
  els.degreeHint.innerHTML = `Grado ${m} usa ${m + 1} puntos (máximo grado ${MAX_POINTS - 1} con ${MAX_POINTS} puntos). Ahora hay ${n} filas.${missing}`;
}

/** Si el grado pide más puntos que filas, agrega filas vacías para completarlos. */
function ensureRowsForDegree() {
  const need = Number(els.degree.value) + 1;
  if (need <= state.rows.length) return 0;
  const added = need - state.rows.length;
  while (state.rows.length < need) state.rows.push(emptyRow());
  renderRows();
  return added;
}

const isManual = () => els.selManual.checked;

function updateSelectionHint() {
  const m = Number(els.degree.value);
  const manual = isManual();
  els.table.classList.toggle('manual', manual);
  if (!manual) {
    els.selHint.className = 'hint small';
    els.selHint.innerHTML = m + 1 === state.rows.length
      ? `Se usan todos los puntos (i = 0 … ${m}).`
      : `Se usan los puntos i = 0 … ${m} (los primeros ${m + 1}, en el orden ingresado).`;
    return;
  }
  const k = state.rows.filter((r) => r.use).length;
  const ok = k === m + 1;
  els.selHint.className = `hint small ${ok ? 'ok' : 'warn'}`;
  els.selHint.innerHTML = `Marca exactamente ${m + 1} puntos en la columna «Usar». Seleccionados: <strong>${k} / ${m + 1}</strong>. Se respetará el orden de la tabla.`;
}

function preselectFirst() {
  const m = Number(els.degree.value);
  state.rows.forEach((r, i) => (r.use = i <= m));
}

function setRows(rows) {
  state.rows = rows.slice(0, MAX_POINTS);
  while (state.rows.length < MIN_POINTS) state.rows.push(emptyRow());
  renderRows();
  if (isManual()) {
    preselectFirst();
    renderRows();
  }
}

function fillFromPaste(parsed, startRow, startField) {
  const rows = state.rows.map((r) => ({ ...r }));
  const oneColumn = parsed.rows.every((r) => r[1] === '');
  let truncated = false;
  parsed.rows.forEach((cells, k) => {
    const i = startRow + k;
    if (i >= MAX_POINTS) return (truncated = true);
    if (!rows[i]) rows.push(emptyRow());
    if (oneColumn) rows[i][startField] = cells[0];
    else if (startField === 'y') rows[i].y = cells[0];
    else [rows[i].x, rows[i].y] = cells;
  });
  setRows(rows);
  return truncated;
}

function clearFieldErrors() {
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  document.querySelectorAll('.field-msg').forEach((el) => (el.textContent = ''));
  els.formMsg.textContent = '';
}

function fieldError(input, msgEl, text) {
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
  msgEl.textContent = text;
}

/* =========================================================
   Validación
   ========================================================= */

function collectInput() {
  clearFieldErrors();
  const errors = [];
  const n = state.rows.length;
  const points = [];
  const cell = (i, f) => els.body.querySelector(`input[data-field="${f}"][data-row="${i}"]`);

  if (n < MIN_POINTS || n > MAX_POINTS) errors.push(`Se requieren entre ${MIN_POINTS} y ${MAX_POINTS} puntos.`);

  state.rows.forEach((r, i) => {
    const px = parseNumber(r.x);
    const py = parseNumber(r.y);
    if (px.empty) fieldError(cell(i, 'x'), $(`#msg-x-${i}`), 'Ingresa xᵢ');
    else if (px.error) fieldError(cell(i, 'x'), $(`#msg-x-${i}`), 'Número no válido');
    if (py.empty) fieldError(cell(i, 'y'), $(`#msg-y-${i}`), 'Ingresa f(xᵢ)');
    else if (py.error) fieldError(cell(i, 'y'), $(`#msg-y-${i}`), 'Número no válido');
    points.push({ x: px.value, y: py.value });
  });

  // xi distintos
  const seen = new Map();
  points.forEach((p, i) => {
    if (p.x === undefined) return;
    if (seen.has(p.x)) {
      const j = seen.get(p.x);
      fieldError(cell(i, 'x'), $(`#msg-x-${i}`), `Repetido (igual a i = ${j})`);
      fieldError(cell(j, 'x'), $(`#msg-x-${j}`), `Repetido (igual a i = ${i})`);
    } else seen.set(p.x, i);
  });

  const pe = parseNumber(els.xEval.value);
  if (pe.empty) fieldError(els.xEval, els.xEvalMsg, 'Ingresa el valor de x que deseas evaluar.');
  else if (pe.error) fieldError(els.xEval, els.xEvalMsg, 'Número no válido.');

  const m = Number(els.degree.value);
  let used = Array.from({ length: m + 1 }, (_, i) => i);
  if (m + 1 > n) {
    errors.push(`Para grado ${m} necesitas ${m + 1} puntos y hay ${n}. Agrega ${m + 1 - n} ${m + 1 - n === 1 ? 'fila' : 'filas'} o elige un grado menor.`);
  } else if (isManual()) {
    used = state.rows.map((r, i) => (r.use ? i : -1)).filter((i) => i >= 0);
    if (used.length !== m + 1) {
      errors.push(`Para grado ${m} debes marcar exactamente ${m + 1} puntos (marcados: ${used.length}).`);
      els.selHint.classList.add('warn');
    }
  }

  const invalid = document.querySelector('.invalid');
  if (invalid || errors.length) {
    if (invalid) errors.unshift('Revisa los campos marcados en rojo.');
    els.formMsg.innerHTML = errors.map(esc).join('<br>');
    (invalid || els.formMsg).focus?.();
    return null;
  }
  return { points, m, used, xEval: pe.value, mode: isManual() ? 'manual' : 'first' };
}

/* =========================================================
   Resultados
   ========================================================= */

function renderEmpty() {
  els.results.innerHTML = `
    <div class="card empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64"><path d="M8 48 C20 8, 34 60, 56 16" /><circle cx="8" cy="48" r="4"/><circle cx="26" cy="30" r="4"/><circle cx="40" cy="38" r="4"/><circle cx="56" cy="16" r="4"/></svg>
      </div>
      <h2>Aquí verás el procedimiento completo</h2>
      <p>Ingresa los puntos (x<sub>i</sub>, f(x<sub>i</sub>)), el valor de x y el grado. Luego presiona <strong>Calcular</strong>.</p>
      <ol class="empty-steps">
        <li>Datos y puntos utilizados</li>
        <li>Tabla de diferencias divididas</li>
        <li>Desarrollo de cada diferencia</li>
        <li>Coeficientes a<sub>k</sub></li>
        <li>Polinomio de Newton</li>
        <li>Sustitución de x</li>
        <li>Resultado P<sub>m</sub>(x)</li>
        <li>Polinomios de todos los grados</li>
        <li>Comparación de grados</li>
        <li>Gráfico</li>
      </ol>
    </div>`;
}

function section(num, title, body, extraClass = '') {
  return `
    <article class="card step ${extraClass}" id="step-${num}">
      <header class="step-head"><span class="step-num">${num}</span><h2>${title}</h2></header>
      ${body}
    </article>`;
}

function renderResults(sol) {
  DEC = Number(els.decimals.value);
  const P = `P<sub>${sol.m}</sub>`;
  const x = fmtIn(sol.xEval);
  const parts = [
    `<div class="card summary">
      <div>
        <div class="summary-label">Resultado</div>
        <div class="summary-value">${P}(${x}) ≈ <strong>${fmt(sol.value)}</strong></div>
      </div>
      <div class="summary-meta">
        Grado ${sol.m} · ${sol.m + 1} puntos · ${DEC} decimales
        <div class="inline-actions summary-actions no-print">
          <button type="button" class="btn btn-ghost btn-sm" data-export="csv">Exportar CSV</button>
          <button type="button" class="btn btn-ghost btn-sm" data-export="print">Vista imprimible</button>
        </div>
      </div>
    </div>`,
    section(1, 'Datos ingresados y puntos utilizados', renderData(sol)),
    section(2, 'Tabla de diferencias divididas', renderTriangle(sol)),
    section(3, 'Desarrollo de cada diferencia dividida', renderDevelopment(sol)),
    section(4, 'Coeficientes del polinomio', renderCoefs(sol)),
    section(5, 'Polinomio en forma de Newton', renderPolynomial(sol)),
    section(6, `Sustitución de x = ${x}`, renderSubstitution(sol)),
    section(7, 'Resultado', renderFinal(sol), 'step-result'),
  ];
  parts.push(
    section(8, 'Polinomios de todos los grados', renderAllDegrees(sol)),
    section(9, 'Comparación de todos los grados', renderComparison(sol)),
    section(10, 'Gráfico', renderChart(sol)),
  );
  els.results.innerHTML = parts.join('');
}

function renderData(sol) {
  const pos = new Map(sol.used.map((i, k) => [i, k]));
  const rows = sol.points
    .map((p, i) => {
      const k = pos.get(i);
      const usedTag = k === undefined ? '<span class="tag tag-muted">No usado</span>' : `<span class="tag">${xv(k)}</span>`;
      return `<tr class="${k === undefined ? 'muted-row' : ''}"><td>${i}</td><td>${fmtIn(p.x)}</td><td>${fmtIn(p.y)}</td><td>${usedTag}</td></tr>`;
    })
    .join('');

  const all = sol.m + 1 === sol.n;
  let why;
  if (all) why = `Con n = ${sol.n} puntos y grado m = ${sol.m} = n − 1 se usan <strong>todos</strong> los puntos.`;
  else if (sol.mode === 'first')
    why = `Un polinomio de grado m = ${sol.m} necesita m + 1 = ${sol.m + 1} puntos. Se toman los <strong>primeros ${sol.m + 1}</strong> en el orden ingresado (i = 0 … ${sol.m}); los demás no intervienen. Los puntos no se reordenan.`;
  else
    why = `Un polinomio de grado m = ${sol.m} necesita m + 1 = ${sol.m + 1} puntos. Se usan los <strong>${sol.m + 1} puntos elegidos manualmente</strong>, en el orden de la tabla, y se renombran como ${xv(0)} … ${xv(sol.m)}.`;

  const sp = sol.spacing;
  const spacing = sp.equi
    ? `Nodos utilizados <strong>equidistantes</strong> (h = ${fmt(sp.h)}).`
    : 'Nodos utilizados <strong>no equidistantes</strong>; el método de diferencias divididas funciona igual.';

  return `
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>i</th><th>x<sub>i</sub></th><th>f(x<sub>i</sub>)</th><th>En el polinomio</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">${why}</p>
    <p class="note">${spacing} Valor a evaluar: <var>x</var> = ${fmtIn(sol.xEval)}.</p>`;
}

function renderTriangle(sol) {
  const { D, xs, m } = sol;
  const head = Array.from({ length: m }, (_, k) => `<th>Orden ${k + 1}<div class="th-sub">${ddLabelGeneric(k + 1)}</div></th>`).join('');
  const body = xs
    .map((xi, i) => {
      const cells = Array.from({ length: m }, (_, k) => {
        const j = k + 1;
        if (i + j > m) return '<td class="empty-cell"></td>';
        return `<td class="${i === 0 ? 'coef-cell' : ''}">${fmt(D[i][j])}</td>`;
      }).join('');
      return `<tr><td>${i}</td><td>${fmtIn(xi)}</td><td class="${i === 0 ? 'coef-cell' : ''}">${fmtIn(D[i][0])}</td>${cells}</tr>`;
    })
    .join('');
  return `
    <p class="note">Cada columna se obtiene de la anterior: D<sub>i,j</sub> = (D<sub>i+1,j−1</sub> − D<sub>i,j−1</sub>) / (x<sub>i+j</sub> − x<sub>i</sub>). La primera fila (resaltada) contiene los coeficientes a<sub>j</sub> = D<sub>0,j</sub>.</p>
    <div class="table-scroll"><table class="dd-table">
      <thead><tr><th>i</th><th>x<sub>i</sub></th><th>Orden 0<div class="th-sub">f[x<sub>i</sub>]</div></th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function renderDevelopment(sol) {
  const { D, xs, m } = sol;
  const fmtPrev = (j) => (j === 1 ? fmtIn : fmt); // orden 0 = datos ingresados
  const groups = [];
  for (let j = 1; j <= m; j++) {
    const f = fmtPrev(j);
    const items = [];
    for (let i = 0; i + j <= m; i++) {
      const hi = D[i + 1][j - 1];
      const lo = D[i][j - 1];
      const num = hi - lo;
      const den = xs[i + j] - xs[i];
      items.push(`
        <div class="dd-item">
          <div class="dd-tag">D<sub>${i},${j}</sub></div>
          <div class="math-line">
            <span>${ddLabel(i, j)}</span> =
            ${frac(`${ddLabel(i + 1, j - 1)} ${MINUS} ${ddLabel(i, j - 1)}`, `${xv(i + j)} ${MINUS} ${xv(i)}`)} =
            ${frac(minus(f(hi), lo, f), minus(fmtIn(xs[i + j]), xs[i], fmtIn))} =
            ${frac(fmt(num), fmt(den))} =
            <strong class="res">${fmt(D[i][j])}</strong>
          </div>
        </div>`);
    }
    groups.push(`
      <details class="dd-group" ${m <= 4 || j === 1 ? 'open' : ''}>
        <summary>Orden ${j} <span class="count">${items.length} ${items.length === 1 ? 'diferencia' : 'diferencias'}</span></summary>
        ${items.join('')}
      </details>`);
  }
  return `
    <p class="note">Orden 0: ${ddLabelGeneric(0)} = f(x<sub>i</sub>) = y<sub>i</sub>. Los valores intermedios se muestran redondeados, pero cada cálculo usa la precisión completa.</p>
    ${groups.join('')}`;
}

function renderCoefs(sol) {
  const chips = sol.coefs
    .map((a, k) => `
      <div class="coef-chip">
        <div class="coef-name">a<sub>${k}</sub> = ${ddLabel(0, k)}</div>
        <div class="coef-val">${fmt(a)}</div>
      </div>`)
    .join('');
  return `<p class="note">Los coeficientes son a<sub>j</sub> = D<sub>0,j</sub>, es decir, la primera fila de la tabla.</p><div class="coef-grid">${chips}</div>`;
}

/** a0 + a1(x − x0) + … + am(x − x0)…(x − x_{m−1}) */
function generalForm(m) {
  return Array.from({ length: m + 1 }, (_, k) => {
    const factors = Array.from({ length: k }, (_, l) => `(<var>x</var> ${MINUS} ${xv(l)})`).join('');
    return `${k === 0 ? '' : ' + '}a<sub>${k}</sub>${factors}`;
  }).join('');
}

/** Polinomio con coeficientes y nodos numéricos. */
function valuesForm(coefs, xs) {
  return signedSum(
    coefs.map((a, k) => ({ v: a, html: (abs) => `${fmt(abs)}${xs.slice(0, k).map(factorHTML).join('')}` })),
  );
}

function renderPolynomial(sol) {
  const { m, coefs, xs } = sol;
  const general = generalForm(m);
  const values = valuesForm(coefs, xs);
  const nodes = xs.map((x, k) => `${xv(k)} = ${fmtIn(x)}`).join(', ');
  return `
    <h3 class="sub-title">Forma general</h3>
    <div class="formula">P<sub>${m}</sub>(<var>x</var>) = ${general}</div>
    <p class="note">P<sub>m</sub>(x) = a<sub>0</sub> + Σ<sub>j=1…m</sub> a<sub>j</sub> · Π<sub>k=0…j−1</sub> (x − x<sub>k</sub>)</p>
    <h3 class="sub-title">Con los valores del ejercicio</h3>
    <p class="note">Nodos: ${nodes}</p>
    <div class="formula formula-strong">P<sub>${m}</sub>(<var>x</var>) = ${values}</div>`;
}

function renderSubstitution(sol) {
  const x = fmtIn(sol.xEval);
  const rows = sol.terms
    .map((t) => {
      const symbolic = `a<sub>${t.k}</sub>${Array.from({ length: t.k }, (_, l) => `(<var>x</var> ${MINUS} ${xv(l)})`).join('')}`;
      const subst = t.k === 0
        ? fmt(t.a)
        : `${paren(t.a)} · ${sol.xs.slice(0, t.k).map((xk) => `(${minus(x, xk, fmtIn)})`).join('')}`;
      const product = t.k === 0 ? '—' : `${t.diffs.map((d) => `(${fmt(d)})`).join('')} = ${fmt(t.prod)}`;
      return `<tr>
        <td>${t.k}</td>
        <td class="math-cell">${symbolic}</td>
        <td class="math-cell">${subst}</td>
        <td class="math-cell">${product}</td>
        <td class="num-cell"><strong>${fmt(t.value)}</strong></td>
      </tr>`;
    })
    .join('');
  const sum = signedSum(sol.terms.map((t) => ({ v: t.value, html: (abs) => fmt(abs) })));
  const warn = sol.extrapolation
    ? `<p class="alert">x = ${x} está fuera del intervalo de los nodos utilizados [${fmtIn(Math.min(...sol.xs))}, ${fmtIn(Math.max(...sol.xs))}]: es una <strong>extrapolación</strong> y puede ser poco precisa.</p>`
    : '';
  return `
    <div class="table-scroll"><table class="data-table subst-table">
      <thead><tr><th>k</th><th>Término</th><th>Sustitución</th><th>Producto Π</th><th>a<sub>k</sub> · Π</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <h3 class="sub-title">Suma de los términos</h3>
    <div class="formula">P<sub>${sol.m}</sub>(${x}) = ${sum} = <strong>${fmt(sol.value)}</strong></div>
    ${warn}`;
}

function renderFinal(sol) {
  return `
    <div class="result-box">
      <div class="result-label">Valor interpolado</div>
      <div class="result-value">P<sub>${sol.m}</sub>(${fmtIn(sol.xEval)}) = ${fmt(sol.value)}</div>
      <div class="result-meta">Polinomio de grado ${sol.m} con los nodos ${sol.xs.map((v) => fmtIn(v)).join(', ')}</div>
    </div>`;
}

/** Tarjeta de un grado g: nodos, fórmula, sustitución, operaciones y resultado. */
function renderDegreeCard(d, xEval) {
  const x = fmtIn(xEval);
  const P = `P<sub>${d.g}</sub>`;
  const nodeRows = d.xs
    .map((xi, k) => `<tr><td>${k}</td><td>${fmtIn(xi)}</td><td>${fmtIn(d.ys[k])}</td></tr>`)
    .join('');
  const coefList = d.coefs.map((a, k) => `a<sub>${k}</sub> = ${fmt(a)}`).join('; ');
  const substituted = d.terms
    .map((t) => {
      const body = t.k === 0
        ? paren(t.a)
        : `${paren(t.a)} · ${d.xs.slice(0, t.k).map((xk) => `(${minus(x, xk, fmtIn)})`).join('')}`;
      return (t.k === 0 ? '' : ' + ') + body;
    })
    .join('');
  const operations = d.terms
    .map((t) => {
      const lhs = t.k === 0 ? `a<sub>0</sub>` : `${paren(t.a)} · ${t.diffs.map((v) => `(${fmt(v)})`).join('')}`;
      return `<li>Término ${t.k}: ${lhs} = <strong>${fmt(t.value)}</strong></li>`;
    })
    .join('');
  const sum = signedSum(d.terms.map((t) => ({ v: t.value, html: (abs) => fmt(abs) })));
  const extra = d.extrapolation ? ' <span class="tag tag-warn">Extrapolación</span>' : '';

  return `
    <details class="dd-group degree-card">
      <summary>
        <span class="degree-name">${P}(<var>x</var>), grado ${d.g}</span>
        <span class="count">${d.g + 1} nodos: i = 0 … ${d.g}</span>
        <span class="degree-peek">${P}(${x}) = <strong>${fmt(d.value)}</strong>${extra}</span>
      </summary>
      <div class="degree-body">
      <ol class="degree-steps">
        <li>
          <h4>Nodos utilizados</h4>
          <div class="table-scroll"><table class="data-table compact">
            <thead><tr><th>i</th><th>x<sub>i</sub></th><th>f(x<sub>i</sub>)</th></tr></thead>
            <tbody>${nodeRows}</tbody>
          </table></div>
        </li>
        <li>
          <h4>Fórmula de Newton</h4>
          <div class="formula">${P}(<var>x</var>) = ${generalForm(d.g)}</div>
        </li>
        <li>
          <h4>Con coeficientes y nodos</h4>
          <p class="note">${coefList}</p>
          <div class="formula">${P}(<var>x</var>) = ${valuesForm(d.coefs, d.xs)}</div>
        </li>
        <li>
          <h4>Reemplazando <var>x</var> = ${x}</h4>
          <div class="formula">${P}(${x}) = ${substituted}</div>
        </li>
        <li>
          <h4>Operaciones</h4>
          <ul class="degree-ops">${operations}</ul>
          <div class="formula">${P}(${x}) = ${sum}</div>
        </li>
      </ol>
      <div class="degree-result">${P}(${x}) = <strong>${fmt(d.value)}</strong></div>
      </div>
    </details>`;
}

function renderAllDegrees(sol) {
  const manual = sol.mode === 'manual'
    ? ' Esta sección no depende de la selección manual ni del grado elegido arriba.'
    : ' Esta sección no depende del grado elegido para el desarrollo detallado.';
  return `
    <p class="note">Con n = ${sol.n} puntos se generan los polinomios P<sub>1</sub> hasta P<sub>${sol.n - 1}</sub>. Cada P<sub>g</sub> usa los primeros g + 1 puntos en el orden ingresado.${manual}</p>
    <div class="inline-actions degree-toggle">
      <button type="button" class="btn btn-ghost btn-sm" data-degrees="open">Mostrar todos</button>
      <button type="button" class="btn btn-ghost btn-sm" data-degrees="close">Ocultar todos</button>
    </div>
    <div class="degree-list">${sol.degrees.map((d) => renderDegreeCard(d, sol.xEval)).join('')}</div>`;
}

function renderComparison(sol) {
  const x = fmtIn(sol.xEval);
  const rows = sol.degrees
    .map((d) => {
      const current = sol.mode === 'first' && d.g === sol.m;
      const nodes = d.xs.map((v) => fmtIn(v)).join(', ');
      return `<tr class="${current ? 'current-row' : ''}">
        <td>${d.g}${current ? ' <span class="tag">desarrollado arriba</span>' : ''}</td>
        <td>i = 0 … ${d.g} <span class="muted">(${nodes})</span></td>
        <td class="num-cell"><strong>P<sub>${d.g}</sub>(${x}) = ${fmt(d.value)}</strong>${d.extrapolation ? ' <span class="tag tag-warn">Extrapolación</span>' : ''}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Grado</th><th>Nodos utilizados</th><th>Resultado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/* =========================================================
   Gráfico SVG (sin librerías)
   ========================================================= */

function renderChart(sol) {
  const W = 760, H = 460;
  const pad = { l: 72, r: 24, t: 56, b: 52 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  const xsAll = sol.points.map((p) => p.x).concat(sol.xEval);
  let xmin = Math.min(...xsAll), xmax = Math.max(...xsAll);
  if (xmax === xmin) { xmin -= 1; xmax += 1; }
  const xspan = xmax - xmin;
  xmin -= xspan * 0.06;
  xmax += xspan * 0.06;

  const N = 400;
  const curve = Array.from({ length: N + 1 }, (_, k) => {
    const x = xmin + ((xmax - xmin) * k) / N;
    return [x, evalNewton(sol.coefs, sol.xs, x)];
  });

  // Rango vertical: datos + punto evaluado; la curva amplía hasta un límite razonable.
  const ysData = sol.points.map((p) => p.y).concat(sol.value);
  let ymin = Math.min(...ysData), ymax = Math.max(...ysData);
  const dspan = ymax - ymin || Math.abs(ymax) || 1;
  const cy = curve.map((c) => c[1]).filter(Number.isFinite);
  ymin = Math.max(Math.min(ymin, ...cy), ymin - 1.5 * dspan);
  ymax = Math.min(Math.max(ymax, ...cy), ymax + 1.5 * dspan);
  if (ymax === ymin) { ymin -= 1; ymax += 1; }
  const yspan = ymax - ymin;
  ymin -= yspan * 0.08;
  ymax += yspan * 0.08;

  const sx = (x) => pad.l + ((x - xmin) / (xmax - xmin)) * pw;
  const sy = (y) => pad.t + (1 - (y - ymin) / (ymax - ymin)) * ph;
  const r2 = (v) => Math.round(v * 100) / 100;

  const xt = niceTicks(xmin, xmax, 7);
  const yt = niceTicks(ymin, ymax, 6);

  const grid = [
    ...xt.ticks.map((t) => `<line class="grid" x1="${r2(sx(t))}" x2="${r2(sx(t))}" y1="${pad.t}" y2="${pad.t + ph}"/>
      <text class="tick" x="${r2(sx(t))}" y="${pad.t + ph + 20}" text-anchor="middle">${tickLabel(t, xt.step)}</text>`),
    ...yt.ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${pad.l + pw}" y1="${r2(sy(t))}" y2="${r2(sy(t))}"/>
      <text class="tick" x="${pad.l - 10}" y="${r2(sy(t)) + 4}" text-anchor="end">${tickLabel(t, yt.step)}</text>`),
  ].join('');

  const zeroAxes = [
    xmin < 0 && xmax > 0 ? `<line class="zero" x1="${r2(sx(0))}" x2="${r2(sx(0))}" y1="${pad.t}" y2="${pad.t + ph}"/>` : '',
    ymin < 0 && ymax > 0 ? `<line class="zero" x1="${pad.l}" x2="${pad.l + pw}" y1="${r2(sy(0))}" y2="${r2(sy(0))}"/>` : '',
  ].join('');

  let d = '';
  let pen = false;
  for (const [x, y] of curve) {
    if (!Number.isFinite(y)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${r2(sx(x))},${r2(sy(y))}`;
    pen = true;
  }

  const usedSet = new Set(sol.used);
  const pts = sol.points
    .map((p, i) => usedSet.has(i)
      ? `<circle class="pt-used" cx="${r2(sx(p.x))}" cy="${r2(sy(p.y))}" r="5.5"><title>i = ${i}: (${p.x}, ${p.y})</title></circle>`
      : `<circle class="pt-unused" cx="${r2(sx(p.x))}" cy="${r2(sy(p.y))}" r="5"><title>i = ${i} (no usado): (${p.x}, ${p.y})</title></circle>`)
    .join('');

  const ex = r2(sx(sol.xEval)), ey = r2(sy(sol.value));
  const labelRight = ex < pad.l + pw * 0.7;
  const evalLabel = `(${fmtIn(sol.xEval)}, ${fmt(sol.value, Math.min(DEC, 6))})`.replace(/<[^>]+>/g, '');
  const evalMark = `
    <line class="guide" x1="${ex}" x2="${ex}" y1="${ey}" y2="${pad.t + ph}"/>
    <line class="guide" x1="${pad.l}" x2="${ex}" y1="${ey}" y2="${ey}"/>
    <rect class="pt-eval" x="${ex - 6.5}" y="${ey - 6.5}" width="13" height="13" transform="rotate(45 ${ex} ${ey})"><title>P(${sol.xEval}) = ${sol.value}</title></rect>
    <text class="eval-label" x="${labelRight ? ex + 12 : ex - 12}" y="${ey - 12}" text-anchor="${labelRight ? 'start' : 'end'}">${evalLabel}</text>`;

  const hasUnused = sol.used.length < sol.n;
  const legendItems = [
    `<circle class="pt-used" cx="8" cy="0" r="5"/><text x="20" y="4">Puntos utilizados</text>`,
    ...(hasUnused ? [`<circle class="pt-unused" cx="8" cy="0" r="5"/><text x="20" y="4">No utilizados</text>`] : []),
    `<line class="curve" x1="0" x2="22" y1="0" y2="0"/><text x="30" y="4">P${toSub(sol.m)}(x)</text>`,
    `<rect class="pt-eval" x="2" y="-6" width="11" height="11" transform="rotate(45 7.5 -0.5)"/><text x="20" y="4">Punto evaluado</text>`,
  ];
  const widths = [150, ...(hasUnused ? [128] : []), 84, 140];
  let lx = pad.l;
  const legend = legendItems
    .map((item, k) => {
      const g = `<g transform="translate(${lx},26)">${item}</g>`;
      lx += widths[k];
      return g;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Gráfico del polinomio de grado ${sol.m}, los puntos ingresados y el punto evaluado">
        <defs><clipPath id="plot-clip"><rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}"/></clipPath></defs>
        <g class="legend">${legend}</g>
        ${grid}
        ${zeroAxes}
        <rect class="frame" x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}"/>
        <path class="curve" d="${d}" clip-path="url(#plot-clip)"/>
        <g clip-path="url(#plot-clip)">${evalMark}</g>
        ${pts}
        <text class="axis-label" x="${pad.l + pw / 2}" y="${H - 10}" text-anchor="middle">x</text>
        <text class="axis-label" transform="translate(18 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">f(x)</text>
      </svg>
    </div>
    <p class="note">La curva corresponde a P<sub>${sol.m}</sub>(x); los nodos utilizados pasan exactamente por ella.</p>`;
}

/* =========================================================
   Eventos
   ========================================================= */

function calculate() {
  const input = collectInput();
  if (!input) return;
  state.solution = solveNewton(input);
  renderResults(state.solution);
  if (window.matchMedia('(max-width: 979px)').matches) {
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

els.body.addEventListener('input', (e) => {
  const t = e.target;
  const i = Number(t.dataset.row);
  const field = t.dataset.field;
  if (!field) return;
  if (field === 'use') {
    state.rows[i].use = t.checked;
    updateSelectionHint();
    return;
  }
  state.rows[i][field] = t.value;
  t.classList.remove('invalid');
  t.removeAttribute('aria-invalid');
  const msg = $(`#msg-${field}-${i}`);
  if (msg) msg.textContent = '';
});

els.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn || state.rows.length <= MIN_POINTS) return;
  state.rows.splice(Number(btn.dataset.row), 1);
  renderRows();
});

els.body.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || !t.classList.contains('cell-input')) return;
  e.preventDefault();
  const i = Number(t.dataset.row);
  if (i + 1 >= state.rows.length) {
    if (state.rows.length >= MAX_POINTS) return calculate();
    state.rows.push(emptyRow());
    renderRows();
  }
  els.body.querySelector(`input[data-field="${t.dataset.field}"][data-row="${i + 1}"]`)?.focus();
});

els.body.addEventListener('paste', (e) => {
  const t = e.target;
  if (!t.classList.contains('cell-input')) return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (!/[\t\n]/.test(text.trim())) return; // pegado simple: comportamiento normal
  e.preventDefault();
  const parsed = parsePasted(text);
  const truncated = fillFromPaste(parsed, Number(t.dataset.row), t.dataset.field);
  els.pasteMsg.textContent = truncated ? `Se ignoraron filas que superaban el máximo de ${MAX_POINTS}.` : '';
  if (truncated) els.formMsg.textContent = `Solo se admiten ${MAX_POINTS} puntos; se ignoraron las filas sobrantes.`;
});

els.addRow.addEventListener('click', () => {
  if (state.rows.length >= MAX_POINTS) return;
  state.rows.push(emptyRow());
  renderRows();
  els.body.querySelector(`input[data-field="x"][data-row="${state.rows.length - 1}"]`)?.focus();
});

els.pasteApply.addEventListener('click', () => {
  const text = els.pasteArea.value;
  if (!text.trim()) {
    els.pasteMsg.className = 'inline-msg error';
    els.pasteMsg.textContent = 'Pega primero los datos en el cuadro.';
    return;
  }
  const parsed = parsePasted(text);
  if (parsed.rows.length < MIN_POINTS) {
    els.pasteMsg.className = 'inline-msg error';
    els.pasteMsg.textContent = `Se necesitan al menos ${MIN_POINTS} filas con dos columnas.`;
    return;
  }
  const truncated = parsed.rows.length > MAX_POINTS;
  setRows(parsed.rows.map(([x, y]) => ({ x, y, use: false })));
  const notes = [...parsed.notes];
  if (truncated) notes.push(`solo se tomaron las primeras ${MAX_POINTS} filas`);
  els.pasteMsg.className = `inline-msg ${truncated ? 'error' : 'ok'}`;
  els.pasteMsg.textContent = `${state.rows.length} puntos insertados${notes.length ? ` (${notes.join('; ')})` : ''}.`;
});

els.degree.addEventListener('change', () => {
  state.degreeTouched = true;
  const added = ensureRowsForDegree();
  updateDegreeHint();
  if (added) {
    els.degreeHint.innerHTML += ` Se agregaron ${added} ${added === 1 ? 'fila vacía' : 'filas vacías'} para completar los puntos.`;
    els.body.querySelector(`input[data-row="${state.rows.length - added}"][data-field="x"]`)?.focus();
  }
  updateSelectionHint();
});

els.decimals.addEventListener('change', () => {
  if (state.solution) renderResults(state.solution);
});

[els.selFirst, els.selManual].forEach((r) =>
  r.addEventListener('change', () => {
    if (isManual() && !state.rows.some((row) => row.use)) {
      preselectFirst();
      renderRows();
    }
    updateSelectionHint();
  }),
);

els.xEval.addEventListener('input', () => {
  els.xEval.classList.remove('invalid');
  els.xEvalMsg.textContent = '';
});
els.xEval.addEventListener('keydown', (e) => e.key === 'Enter' && calculate());

els.calc.addEventListener('click', calculate);

// Mostrar u ocultar todas las tarjetas de grado; exportar
els.results.addEventListener('click', (e) => {
  const action = e.target.closest('[data-degrees]')?.dataset.degrees;
  if (action) els.results.querySelectorAll('.degree-card').forEach((d) => (d.open = action === 'open'));
  const exp = e.target.closest('[data-export]')?.dataset.export;
  if (exp === 'csv' && state.solution) exportCSV(state.solution);
  if (exp === 'print' && state.solution) {
    printReport(`<h1>Interpolación de Newton</h1>${printableClone(els.results)}`);
  }
});

/** CSV con los datos, la tabla de diferencias divididas y los polinomios de todos los grados (precisión completa). */
function exportCSV(sol) {
  const num = (v) => (v === null || v === undefined ? '' : v);
  const rows = [];
  sol.points.forEach((p, i) => rows.push([i, p.x, p.y, sol.used.includes(i) ? 'sí' : 'no']));
  rows.push([], ['Diferencias divididas (grado ' + sol.m + ')'], ['i', 'xi', ...Array.from({ length: sol.m + 1 }, (_, j) => `Orden ${j}`)]);
  sol.xs.forEach((xi, i) => rows.push([i, xi, ...sol.D[i].map(num)]));
  rows.push([], ['Coeficientes'], ...sol.coefs.map((a, k) => [`a${k}`, a]));
  rows.push([], [`Resultado P${sol.m}(${sol.xEval})`, sol.value]);
  rows.push([], ['Polinomios de todos los grados'], ['Grado', 'Nodos utilizados', 'Coeficientes', `Pg(${sol.xEval})`, 'Extrapolación']);
  sol.degrees.forEach((d) => rows.push([d.g, d.xs.join('; '), d.coefs.join('; '), d.value, d.extrapolation ? 'sí' : 'no']));
  downloadCSV('newton-interpolacion.csv', ['i', 'xi', 'f(xi)', 'Usado'], rows);
}

els.example.addEventListener('click', () => {
  state.degreeTouched = false;
  els.selFirst.checked = true;
  setRows(EXAMPLE.points.map(([x, y]) => ({ x, y, use: false })));
  els.xEval.value = EXAMPLE.x;
  clearFieldErrors();
  els.pasteMsg.textContent = '';
  calculate();
});

els.clear.addEventListener('click', () => {
  state.degreeTouched = false;
  state.solution = null;
  els.selFirst.checked = true;
  els.xEval.value = '';
  els.pasteArea.value = '';
  els.pasteMsg.textContent = '';
  setRows(Array.from({ length: DEFAULT_ROWS }, emptyRow));
  clearFieldErrors();
  renderEmpty();
});

/* =========================================================
   Inicio
   ========================================================= */

els.decimals.innerHTML = Array.from({ length: 9 }, (_, k) => `<option value="${k + 2}">${k + 2}</option>`).join('');
els.decimals.value = String(DEFAULT_DECIMALS);
setRows(Array.from({ length: DEFAULT_ROWS }, emptyRow));
renderEmpty();
