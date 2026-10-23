import {
  MINUS, parseNumber, numberError, splitPasted, formatNumber, formatInput,
  signedSum, frac, esc, toSup,
} from '../shared/format.js';
import { niceTicks, tickLabel } from '../shared/chart.js';
import {
  jacobi, normInf, matVec, residualVector, zeroDiagonal,
  diagonalDominance, iterationMatrix, findRowPermutation,
} from './jacobi-math.js';

/* =========================================================
   Configuración y estado
   ========================================================= */
const MIN_N = 2;
const MAX_N = 10;
const DEFAULT_N = 3;
const DEFAULT_DECIMALS = 6;
const MAX_ITER_LIMIT = 10000;
const TABLE_HEAD_ROWS = 50; // filas visibles al inicio y al final en tablas largas

// Solo para demostración: el algoritmo no depende de estos datos.
const EXAMPLE = {
  A: [['10', '-1', '2'], ['-1', '11', '-1'], ['2', '-1', '10']],
  b: ['6', '22', '-10'],
  x0: ['0', '0', '0'],
  tol: '0.0001',
  maxIter: '100',
};

const state = {
  n: DEFAULT_N,
  A: [], // string[][]
  b: [], // string[]
  x0: [], // string[]
  solution: null,
  stale: false,
  showAllRows: false,
  pending: null, // { A, b } numérico, para la propuesta de reordenamiento
};

let DEC = DEFAULT_DECIMALS;
const fmt = (v, dec = DEC) => formatNumber(v, dec);
const fmtIn = formatInput;

const $ = (sel) => document.querySelector(sel);
const els = {
  panel: $('#panel-jacobi'),
  inputCard: $('#jac-input'),
  size: $('#jac-size'),
  sizeBadge: $('#jac-size-badge'),
  matrix: $('#jac-matrix'),
  x0: $('#jac-x0'),
  pasteArea: $('#jac-paste'),
  pasteApply: $('#jac-paste-apply'),
  pasteMsg: $('#jac-paste-msg'),
  tol: $('#jac-tol'),
  tolMsg: $('#jac-tol-msg'),
  maxIter: $('#jac-maxit'),
  maxIterMsg: $('#jac-maxit-msg'),
  decimals: $('#jac-decimals'),
  formMsg: $('#jac-form-msg'),
  solve: $('#jac-solve'),
  example: $('#jac-example'),
  clear: $('#jac-clear'),
  results: $('#jac-results'),
};

/* =========================================================
   Notación
   ========================================================= */

const xv = (i) => `<span class="sym"><var>x</var><sub>${i + 1}</sub></span>`;
const xk = (i, k) => `<span class="sym"><var>x</var><sub>${i + 1}</sub><sup>(${k})</sup></span>`;
const vecK = (k) => `<span class="sym"><var>x</var><sup>(${k})</sup></span>`;
const aij = (i, j) => `<span class="sym"><var>a</var><sub>${i + 1}${j + 1}</sub></span>`;
const paren = (v, f = fmt) => (v < 0 ? `(${f(v)})` : f(v));
/** "a − b" fusionando signos. */
const minus = (aHTML, b, f = fmt) => (b < 0 ? `${aHTML} + ${f(-b)}` : `${aHTML} ${MINUS} ${f(b)}`);
/** Coeficiente delante de una variable: 1 → "", 2.5 → "2.5". */
const coef = (abs) => (abs === 1 ? '' : fmtIn(abs));

/** Ecuación i: a_i1 x1 + … = b_i (omite coeficientes cero). */
function equationHTML(row, bi) {
  const items = row.map((a, j) => ({ v: a, html: (abs) => `${coef(abs)}${xv(j)}` })).filter((t) => t.v !== 0);
  const lhs = items.length ? signedSum(items) : '0';
  return `${lhs} = ${fmtIn(bi)}`;
}

/** Numerador del despeje: b_i − Σ_{j≠i} a_ij x_j, con signos fusionados. */
function isolatedNumerator(A, b, i, varHTML) {
  const items = [];
  if (b[i] !== 0) items.push({ v: b[i], html: fmtIn });
  A[i].forEach((a, j) => {
    if (j !== i && a !== 0) items.push({ v: -a, html: (abs) => `${coef(abs)}${varHTML(j)}` });
  });
  return items.length ? signedSum(items) : '0';
}

function matrixHTML(rows, { label = '', cls = '' } = {}) {
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="matrix-block">${label ? `<span class="matrix-label">${label} =</span>` : ''}<table class="bmatrix ${cls}"><tbody>${body}</tbody></table></div>`;
}
const columnHTML = (v, f, label) => matrixHTML(v.map((x) => [f(x)]), { label });

/* =========================================================
   Entrada: matriz aumentada [A | b] y x⁽⁰⁾
   ========================================================= */

const resize = (arr, n, fill) => Array.from({ length: n }, (_, i) => arr[i] ?? fill);

function setSize(n, { keep = true } = {}) {
  state.n = n;
  state.A = Array.from({ length: n }, (_, i) => resize(keep ? state.A[i] ?? [] : [], n, ''));
  state.b = resize(keep ? state.b : [], n, '');
  state.x0 = resize(keep ? state.x0 : [], n, '0');
  els.size.value = String(n);
  renderGrid();
}

function cellInput(kind, i, j, value, label) {
  const id = `jac-${kind}-${i}${j === undefined ? '' : `-${j}`}`;
  const diag = kind === 'a' && i === j ? ' diag' : '';
  return `<input class="cell-input mono${diag}" id="${id}" data-kind="${kind}" data-i="${i}" ${j === undefined ? '' : `data-j="${j}"`}
      inputmode="decimal" autocomplete="off" aria-label="${label}" aria-describedby="${id}-msg" value="${esc(value)}" />
    <div class="field-msg" id="${id}-msg"></div>`;
}

function renderGrid() {
  const n = state.n;
  const head = Array.from({ length: n }, (_, j) => `<th scope="col">${xv(j)}</th>`).join('');
  const rows = state.A.map((row, i) => `
    <tr>
      <th scope="row" class="row-label">Ec. ${i + 1}</th>
      ${row.map((v, j) => `<td>${cellInput('a', i, j, v, `a${i + 1}${j + 1}, ecuación ${i + 1}, coeficiente de x${j + 1}`)}</td>`).join('')}
      <td class="aug-sep" aria-hidden="true"></td>
      <td class="b-cell">${cellInput('b', i, undefined, state.b[i], `b${i + 1}, término independiente de la ecuación ${i + 1}`)}</td>
    </tr>`).join('');
  els.matrix.innerHTML = `
    <thead><tr><th></th>${head}<th class="aug-sep"></th><th scope="col">b</th></tr></thead>
    <tbody>${rows}</tbody>`;

  els.x0.innerHTML = `
    <thead><tr>${Array.from({ length: n }, (_, i) => `<th scope="col">${xk(i, 0)}</th>`).join('')}</tr></thead>
    <tbody><tr>${state.x0.map((v, i) => `<td>${cellInput('x0', i, undefined, v, `x${i + 1} inicial`)}</td>`).join('')}</tr></tbody>`;

  els.sizeBadge.textContent = `${n} × ${n}`;
}

/** Celdas navegables en orden de lectura: A|b fila por fila y luego x⁽⁰⁾. */
const allCells = () => [...els.inputCard.querySelectorAll('.cell-input')];

function fillFromCell(rows, kind, i, j) {
  const n = state.n;
  if (kind === 'x0') {
    rows.flat().forEach((v, k) => { if (i + k < n) state.x0[i + k] = v; });
  } else {
    const startCol = kind === 'b' ? n : j;
    rows.forEach((cells, r) => {
      const row = i + r;
      if (row >= n) return;
      cells.forEach((v, c) => {
        const col = startCol + c;
        if (col < n) state.A[row][col] = v;
        else if (col === n) state.b[row] = v;
      });
    });
  }
  renderGrid();
  markStale();
}

function applyAugmentedPaste(text) {
  let rows = splitPasted(text);
  if (rows.length && rows[0].every((c) => parseNumber(c).value === undefined)) rows = rows.slice(1);
  const n = rows.length;
  if (n < MIN_N || n > MAX_N) {
    return { ok: false, msg: `Se esperan entre ${MIN_N} y ${MAX_N} filas (una por ecuación); se recibieron ${n}.` };
  }
  const bad = rows.findIndex((r) => r.length !== n + 1);
  if (bad >= 0) {
    return { ok: false, msg: `Cada fila debe tener ${n + 1} columnas (${n} de A y 1 de b). La fila ${bad + 1} tiene ${rows[bad].length}.` };
  }
  const sizeChanged = n !== state.n;
  state.A = rows.map((r) => r.slice(0, n));
  state.b = rows.map((r) => r[n]);
  if (sizeChanged) state.x0 = new Array(n).fill('0');
  setSize(n);
  markStale();
  return { ok: true, msg: `Sistema ${n} × ${n} insertado${sizeChanged ? '; x⁽⁰⁾ se reinició en ceros' : ''}.` };
}

/* =========================================================
   Validación
   ========================================================= */

function clearErrors() {
  els.panel.querySelectorAll('.invalid').forEach((el) => {
    el.classList.remove('invalid');
    el.removeAttribute('aria-invalid');
  });
  els.panel.querySelectorAll('.input-panel .field-msg').forEach((el) => (el.textContent = ''));
  els.formMsg.textContent = '';
}

function fieldError(input, text) {
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
  const msg = document.getElementById(`${input.id}-msg`);
  if (msg) msg.textContent = text;
}

/** Lee y valida todo. Devuelve { data } o { zeroDiag, data } o null (errores marcados). */
function collectInput() {
  clearErrors();
  const n = state.n;
  const read = (id, raw, emptyMsg) => {
    const p = parseNumber(raw);
    const err = numberError(p, emptyMsg);
    if (err) fieldError(document.getElementById(id), err);
    return p.value;
  };

  const A = state.A.map((row, i) => row.map((v, j) => read(`jac-a-${i}-${j}`, v, 'Requerido')));
  const b = state.b.map((v, i) => read(`jac-b-${i}`, v, 'Requerido'));
  const x0 = state.x0.map((v, i) => read(`jac-x0-${i}`, v, 'Requerido'));
  const errors = [];

  if (A.length !== n || A.some((r) => r.length !== n) || b.length !== n || x0.length !== n) {
    errors.push(`Las dimensiones no coinciden: A debe ser ${n} × ${n}, y b y x⁽⁰⁾ deben tener ${n} componentes.`);
  }

  const pt = parseNumber(els.tol.value);
  let tol = pt.value;
  if (numberError(pt)) fieldError(els.tol, numberError(pt, 'Ingresa la tolerancia'));
  else if (!(tol > 0)) fieldError(els.tol, 'Debe ser un número positivo');

  const rawMax = els.maxIter.value.trim();
  const maxIter = Number(rawMax);
  if (!rawMax) fieldError(els.maxIter, 'Ingresa el máximo de iteraciones');
  else if (!/^\+?\d+$/.test(rawMax) || !Number.isInteger(maxIter) || maxIter < 1) fieldError(els.maxIter, 'Debe ser un entero positivo');
  else if (maxIter > MAX_ITER_LIMIT) fieldError(els.maxIter, `Máximo admitido: ${MAX_ITER_LIMIT}`);

  const firstInvalid = els.panel.querySelector('.input-panel .invalid');
  if (firstInvalid || errors.length) {
    if (firstInvalid) errors.unshift('Revisa los campos marcados en rojo. Los campos vacíos no se toman como cero.');
    els.formMsg.innerHTML = errors.map(esc).join('<br>');
    firstInvalid?.focus();
    return null;
  }

  const data = { A, b, x0, tol, maxIter };
  const zeros = zeroDiagonal(A);
  if (zeros.length) {
    zeros.forEach((i) => fieldError(document.getElementById(`jac-a-${i}-${i}`), 'Diagonal = 0'));
    els.formMsg.textContent = `Hay ${zeros.length === 1 ? 'un cero' : 'ceros'} en la diagonal (${zeros.map((i) => `a${i + 1}${i + 1}`).join(', ')}). Jacobi divide entre aᵢᵢ y no se puede dividir entre cero.`;
    return { zeroDiag: zeros, data };
  }
  return { data };
}

/* =========================================================
   Resolver
   ========================================================= */

function solve() {
  const input = collectInput();
  if (!input) return;
  if (input.zeroDiag) {
    state.solution = null;
    state.stale = false;
    state.pending = input.data;
    renderZeroDiagonal(input.data, input.zeroDiag);
    return;
  }
  const { A, b, x0, tol, maxIter } = input.data;
  state.pending = input.data;
  state.solution = { A, b, x0, tol, maxIter, n: A.length, run: jacobi(A, b, x0, tol, maxIter) };
  state.stale = false;
  state.showAllRows = false;
  renderResults();
  if (window.matchMedia('(max-width: 979px)').matches) {
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function markStale() {
  if (!state.solution || state.stale) return;
  state.stale = true;
  els.results.classList.add('is-stale');
  els.results.insertAdjacentHTML(
    'afterbegin',
    `<div class="stale-banner" role="status">Los datos cambiaron. Los resultados mostrados ya no corresponden: presiona <strong>Resolver</strong> para recalcular.</div>`,
  );
}

/* =========================================================
   Reordenamiento de ecuaciones
   ========================================================= */

function renderZeroDiagonal(data, zeros) {
  els.results.classList.remove('is-stale');
  els.results.innerHTML = `
    <article class="card step status-card status-error">
      <header class="step-head"><span class="step-num">!</span><h2>No se puede aplicar Jacobi con este orden</h2></header>
      <p>La fórmula ${xk(0, 'k+1').replace('<sub>1</sub>', '<sub>i</sub>')} = (b<sub>i</sub> − Σ<sub>j≠i</sub> a<sub>ij</sub>x<sub>j</sub><sup>(k)</sup>) / a<sub>ii</sub> divide entre el elemento diagonal, y
      ${zeros.map((i) => `${aij(i, i)} = 0`).join(', ')}. No se puede dividir entre cero.</p>
      <p class="note">Puedes intentar intercambiar el orden de las ecuaciones (filas de A junto con b). Las incógnitas no cambian de orden, así que la solución del sistema es la misma.</p>
      <div class="sys-preview">${data.A.map((row, i) => `<div><span class="eq-tag">Ec. ${i + 1}</span> ${equationHTML(row, data.b[i])}</div>`).join('')}</div>
      <button type="button" class="btn btn-secondary" data-action="reorder" data-context="zero">Intentar reordenar ecuaciones</button>
      <div class="reorder-box" id="jac-reorder-box" aria-live="polite"></div>
    </article>`;
}

function renderReorderProposal(context) {
  const box = els.results.querySelector('#jac-reorder-box');
  const data = state.pending;
  if (!box || !data) return;
  const found = findRowPermutation(data.A);
  const identity = found && found.perm.every((p, i) => p === i);

  if (!found) {
    box.innerHTML = `<p class="alert alert-error">No existe ningún orden de las ecuaciones que deje la diagonal sin ceros. No se puede ejecutar esta formulación de Jacobi para este sistema.</p>`;
    return;
  }
  if (context === 'dominance' && (!found.dominant || identity)) {
    box.innerHTML = `<p class="alert">Ninguna permutación de filas logra dominancia diagonal estricta. Puedes seguir usando el orden actual; el método aún podría converger.</p>`;
    return;
  }

  const A2 = found.perm.map((p) => data.A[p]);
  const b2 = found.perm.map((p) => data.b[p]);
  box.innerHTML = `
    <div class="proposal">
      <h3 class="sub-title">Sistema reordenado propuesto</h3>
      <p class="note">Nuevo orden: ${found.perm.map((p, i) => `fila ${i + 1} ← Ec. ${p + 1}`).join(' · ')}. La misma permutación se aplica a b; x⁽⁰⁾ y el orden de las incógnitas no cambian.</p>
      <div class="sys-preview">${A2.map((row, i) => `<div><span class="eq-tag">Ec. ${i + 1}</span> ${equationHTML(row, b2[i])}</div>`).join('')}</div>
      <p class="note">${found.dominant ? '✔ El sistema reordenado es <strong>estrictamente diagonal dominante</strong>, así que Jacobi converge.' : 'La diagonal queda sin ceros, pero el sistema reordenado <strong>no</strong> es estrictamente diagonal dominante: puede o no converger.'}</p>
      <div class="inline-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="apply-perm" data-perm="${found.perm.join(',')}">Usar sistema reordenado</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-perm">Cancelar</button>
      </div>
    </div>`;
}

function applyPermutation(perm) {
  state.A = perm.map((p) => state.A[p]);
  state.b = perm.map((p) => state.b[p]);
  renderGrid();
  solve();
}

/* =========================================================
   Resultados
   ========================================================= */

function renderEmpty() {
  els.results.classList.remove('is-stale');
  els.results.innerHTML = `
    <div class="card empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64"><path d="M10 14 v36 M54 14 v36 M20 22 h10 M20 32 h18 M20 42 h12" /></svg>
      </div>
      <h2>Aquí verás el procedimiento completo</h2>
      <p>Completa la matriz A, el vector b y el vector inicial x⁽⁰⁾. Luego presiona <strong>Resolver</strong>.</p>
      <ol class="empty-steps">
        <li>Sistema de ecuaciones</li>
        <li>Matriz A, b y x⁽⁰⁾</li>
        <li>Análisis de convergencia</li>
        <li>Despeje de cada incógnita</li>
        <li>Fórmula de Jacobi</li>
        <li>Primera iteración</li>
        <li>Tabla de iteraciones</li>
        <li>Resultado y criterio</li>
        <li>Comprobación Ax ≈ b</li>
        <li>Gráfico de convergencia</li>
      </ol>
    </div>`;
}

const section = (num, title, body, extra = '') => `
  <article class="card step ${extra}" id="jac-step-${num}">
    <header class="step-head"><span class="step-num">${num}</span><h2>${title}</h2></header>
    ${body}
  </article>`;

const STATUS = {
  converged: { cls: 'status-ok', icon: '✔', title: 'Tolerancia cumplida' },
  maxIter: { cls: 'status-warn', icon: '!', title: 'Se alcanzó el máximo de iteraciones sin cumplir la tolerancia' },
  nonFinite: { cls: 'status-error', icon: '✕', title: 'Cálculo detenido: valores no finitos' },
};

function renderResults() {
  DEC = Number(els.decimals.value);
  const sol = state.solution;
  const last = sol.run.iterations.at(-1);
  const st = STATUS[sol.run.status];
  const dom = diagonalDominance(sol.A);
  const vec = `(${last.x.map((v) => fmt(v)).join(', ')})`;

  const summary = `
    <div class="card summary ${st.cls}">
      <div class="summary-main">
        <span class="status-pill">${st.icon} ${st.title}</span>
        <div class="summary-value">${vecK(last.k)} ≈ <strong>${vec}</strong></div>
      </div>
      <div class="summary-meta">
        ${last.k} ${last.k === 1 ? 'iteración' : 'iteraciones'} · tolerancia ${fmtIn(sol.tol)}<br>
        ${dom.strict ? 'Diagonal estrictamente dominante' : 'Sin dominancia diagonal estricta'}
      </div>
    </div>`;

  els.results.classList.toggle('is-stale', state.stale);
  els.results.innerHTML = [
    state.stale ? `<div class="stale-banner" role="status">Los datos cambiaron. Los resultados mostrados ya no corresponden: presiona <strong>Resolver</strong> para recalcular.</div>` : '',
    summary,
    section(1, 'Sistema de ecuaciones original', renderSystem(sol)),
    section(2, 'Matriz A, vector b y vector inicial', renderMatrices(sol)),
    section(3, 'Análisis de convergencia', renderConvergence(sol, dom)),
    section(4, 'Despeje de cada incógnita', renderIsolation(sol)),
    section(5, 'Fórmula general de Jacobi', renderFormula(sol)),
    section(6, 'Primera iteración (k = 0 → 1)', renderFirstIteration(sol)),
    section(7, 'Tabla de iteraciones', renderTable(sol)),
    section(8, 'Resultado y criterio de parada', renderOutcome(sol), 'step-result'),
    section(9, 'Comprobación: Ax frente a b', renderCheck(sol)),
    section(10, 'Gráfico de convergencia', renderChart(sol)),
  ].join('');
}

function renderSystem(sol) {
  return `<div class="sys-preview big">${sol.A.map((row, i) => `<div><span class="eq-tag">Ec. ${i + 1}</span> ${equationHTML(row, sol.b[i])}</div>`).join('')}</div>
    <p class="note">${sol.n} ecuaciones con ${sol.n} incógnitas, en la forma <var>A</var><var>x</var> = <var>b</var>.</p>`;
}

function renderMatrices(sol) {
  return `<div class="matrix-row">
      ${matrixHTML(sol.A.map((r) => r.map(fmtIn)), { label: '<var>A</var>' })}
      ${columnHTML(sol.b, fmtIn, '<var>b</var>')}
      ${columnHTML(sol.x0, fmtIn, vecK(0))}
    </div>`;
}

function renderConvergence(sol, dom) {
  const rows = dom.rows
    .map((r) => `<tr>
      <td>${r.i + 1}</td>
      <td class="num-cell">|${aij(r.i, r.i)}| = ${fmtIn(r.diag)}</td>
      <td class="num-cell">${fmtIn(r.off)}</td>
      <td>${r.strict ? '<span class="tag tag-ok">Sí</span>' : '<span class="tag tag-bad">No</span>'} <span class="muted">${fmtIn(r.diag)} ${r.diag > r.off ? '&gt;' : '≤'} ${fmtIn(r.off)}</span></td>
    </tr>`)
    .join('');
  const { T, c } = iterationMatrix(sol.A, sol.b);
  const conclusion = dom.strict
    ? '<p class="alert alert-ok">A es <strong>estrictamente diagonal dominante por filas</strong>. Esta es una condición suficiente: Jacobi converge para cualquier vector inicial.</p>'
    : `<p class="alert">A <strong>no</strong> es estrictamente diagonal dominante por filas. Esto <strong>no demuestra</strong> que el método diverja: la dominancia es solo una condición suficiente. Se realizó el cálculo y abajo se muestra el estado obtenido.</p>
       <button type="button" class="btn btn-secondary btn-sm" data-action="reorder" data-context="dominance">Intentar reordenar ecuaciones</button>
       <div class="reorder-box" id="jac-reorder-box" aria-live="polite"></div>`;

  return `
    <h3 class="sub-title">Dominancia diagonal estricta por filas</h3>
    <p class="note">Se verifica |a<sub>ii</sub>| &gt; Σ<sub>j≠i</sub> |a<sub>ij</sub>| en cada fila.</p>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Fila</th><th>|a<sub>ii</sub>|</th><th>Σ<sub>j≠i</sub> |a<sub>ij</sub>|</th><th>¿Dominancia estricta?</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${conclusion}

    <h3 class="sub-title">Forma matricial</h3>
    <div class="formula">${vecK('k+1')} = <var>T</var> · ${vecK('k')} + <var>c</var>,&nbsp;&nbsp; con T<sub>ii</sub> = 0, &nbsp;T<sub>ij</sub> = −a<sub>ij</sub> / a<sub>ii</sub> (i ≠ j), &nbsp;c<sub>i</sub> = b<sub>i</sub> / a<sub>ii</sub></div>
    <div class="matrix-row">
      ${matrixHTML(T.map((r) => r.map((v) => fmt(v))), { label: '<var>T</var>' })}
      ${columnHTML(c, (v) => fmt(v), '<var>c</var>')}
    </div>
    <p class="note">Jacobi converge para cualquier vector inicial si y solo si el <strong>radio espectral</strong> ρ(T) — el mayor módulo de los autovalores de T — es menor que 1. Esta versión no calcula autovalores; una norma de T no es el radio espectral, por eso no se usa como sustituto.</p>`;
}

function renderIsolation(sol) {
  return `<p class="note">De la ecuación i se despeja la incógnita x<sub>i</sub> (se divide entre a<sub>ii</sub> ≠ 0):</p>
    <div class="eq-list">${sol.A.map((row, i) => `
      <div class="math-line">${xv(i)} = ${frac(isolatedNumerator(sol.A, sol.b, i, xv), fmtIn(row[i]))}</div>`).join('')}
    </div>`;
}

function renderFormula(sol) {
  return `
    <div class="formula">${xk(0, 'k+1').replace('<sub>1</sub>', '<sub>i</sub>')} = ${frac(`b<sub>i</sub> − Σ<sub>j≠i</sub> a<sub>ij</sub> x<sub>j</sub><sup>(k)</sup>`, 'a<sub>ii</sub>')}, &nbsp; i = 1, …, ${sol.n}</div>
    <p class="note">Todas las componentes de ${vecK('k+1')} se calculan con el vector <strong>anterior</strong> ${vecK('k')}. Se guardan en un vector nuevo y solo reemplazan al anterior cuando la iteración termina; usar valores recién calculados dentro de la misma iteración sería el método de Gauss-Seidel.</p>
    <h3 class="sub-title">Aplicada a este sistema</h3>
    <div class="eq-list">${sol.A.map((row, i) => `
      <div class="math-line">${xk(i, 'k+1')} = ${frac(isolatedNumerator(sol.A, sol.b, i, (j) => xk(j, 'k')), fmtIn(row[i]))}</div>`).join('')}
    </div>`;
}

/** Desarrollo completo de la iteración k (de x⁽ᵏ⁻¹⁾ a x⁽ᵏ⁾). */
function iterationDetail(sol, k) {
  const { A, b, n, tol } = sol;
  const prev = sol.run.iterations[k - 1].x;
  const it = sol.run.iterations[k];
  const comps = A.map((row, i) => {
    const others = row.map((a, j) => ({ a, j })).filter((t) => t.j !== i);
    const sum = others.reduce((s, t) => s + t.a * prev[t.j], 0);
    const symbolic = others.map((t) => `${aij(i, t.j)}${xk(t.j, k - 1)}`).join(' + ');
    const products = others.map((t) => `${paren(t.a, fmtIn)}·${paren(prev[t.j])}`).join(' + ');
    return `
      <div class="dd-item">
        <div class="math-line">
          ${xk(i, k)} = ${frac(`b<sub>${i + 1}</sub> − [${symbolic}]`, aij(i, i))}
          = ${frac(`${fmtIn(b[i])} − [${products}]`, fmtIn(row[i]))}
          = ${frac(minus(fmtIn(b[i]), sum), fmtIn(row[i]))}
          = ${frac(fmt(b[i] - sum), fmtIn(row[i]))}
          = <strong class="res">${fmt(it.x[i])}</strong>
        </div>
      </div>`;
  }).join('');

  const diffs = it.x.map((v, i) => Math.abs(v - prev[i]));
  const r = residualVector(A, it.x, b);
  const okE = it.change <= tol, okR = it.residual <= tol;
  return `
    <div class="iter-detail">
      ${comps}
      <div class="dd-item stack">
        <div class="math-line"><span>E<sub>${k}</sub> = ‖${vecK(k)} − ${vecK(k - 1)}‖<sub>∞</sub> = máx(${diffs.map((d) => fmt(d)).join(', ')}) =</span> <strong class="res">${fmt(it.change)}</strong>
          <span class="tag ${okE ? 'tag-ok' : 'tag-bad'}">${okE ? '≤' : '>'} tol</span></div>
        <div class="math-line"><span>R<sub>${k}</sub> = ‖A${vecK(k)} − b‖<sub>∞</sub> = máx(|${r.map((v) => fmt(v)).join('|, |')}|) =</span> <strong class="res">${fmt(it.residual)}</strong>
          <span class="tag ${okR ? 'tag-ok' : 'tag-bad'}">${okR ? '≤' : '>'} tol</span></div>
      </div>
      <p class="note">Valores usados: solo ${vecK(k - 1)} = (${prev.map((v) => fmt(v)).join(', ')}). Las ${n} componentes nuevas se calcularon sin usar ninguna otra componente nueva.</p>
    </div>`;
}

function renderFirstIteration(sol) {
  if (sol.run.iterations.length < 2) {
    return `<p class="alert alert-error">No se pudo completar la primera iteración: se obtuvieron valores no finitos.</p>`;
  }
  return `<p class="note">Se sustituye únicamente el vector inicial ${vecK(0)} = (${sol.x0.map(fmtIn).join(', ')}) en todas las fórmulas.</p>
    ${iterationDetail(sol, 1)}`;
}

function iterationRow(sol, it, isLast) {
  const ok = (v) => (v !== null && v <= sol.tol ? 'ok-val' : '');
  return `<tr class="${isLast ? 'current-row' : ''}" data-k="${it.k}">
    <td>${it.k}</td>
    ${it.x.map((v) => `<td class="num-cell">${fmt(v)}</td>`).join('')}
    <td class="num-cell ${ok(it.change)}">${it.change === null ? '—' : fmt(it.change)}</td>
    <td class="num-cell ${it.k === 0 ? '' : ok(it.residual)}">${fmt(it.residual)}</td>
    <td>${it.k === 0 ? '' : `<button type="button" class="link-btn" data-action="toggle-iter" data-k="${it.k}" aria-expanded="false" aria-controls="jac-iter-${it.k}">Ver</button>`}</td>
  </tr>`;
}

function renderTable(sol) {
  const its = sol.run.iterations;
  const cols = sol.n + 4;
  const lastK = its.at(-1).k;
  let rows;
  if (!state.showAllRows && its.length > TABLE_HEAD_ROWS * 2 + 10) {
    const hidden = its.length - TABLE_HEAD_ROWS * 2;
    rows = [
      ...its.slice(0, TABLE_HEAD_ROWS).map((it) => iterationRow(sol, it, false)),
      `<tr class="gap-row"><td colspan="${cols}">… ${hidden} iteraciones ocultas …
        <button type="button" class="link-btn" data-action="show-all">Mostrar todas</button></td></tr>`,
      ...its.slice(-TABLE_HEAD_ROWS).map((it) => iterationRow(sol, it, it.k === lastK)),
    ];
  } else {
    rows = its.map((it) => iterationRow(sol, it, it.k === lastK));
  }
  return `
    <p class="note">E<sub>k</sub> = ‖x<sup>(k)</sup> − x<sup>(k−1)</sup>‖<sub>∞</sub> es el cambio entre iteraciones (no el error verdadero) y R<sub>k</sub> = ‖Ax<sup>(k)</sup> − b‖<sub>∞</sub> es el residuo. En verde, los valores ≤ tolerancia. Pulsa <strong>Ver</strong> para desplegar el procedimiento de cualquier iteración.</p>
    <div class="table-scroll"><table class="data-table iter-table">
      <thead><tr><th>k</th>${Array.from({ length: sol.n }, (_, i) => `<th>${xk(i, 'k')}</th>`).join('')}<th>Cambio E<sub>k</sub></th><th>Residuo R<sub>k</sub></th><th><span class="sr-only">Detalle</span></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function renderOutcome(sol) {
  const run = sol.run;
  const last = run.iterations.at(-1);
  const tol = fmtIn(sol.tol);
  const criterion = `
    <div class="criterion">
      <strong>Criterio de parada:</strong> el algoritmo se detiene cuando <strong>ambos</strong> se cumplen:
      E<sub>k</sub> = ‖x<sup>(k)</sup> − x<sup>(k−1)</sup>‖<sub>∞</sub> ≤ ${tol} &nbsp;y&nbsp; R<sub>k</sub> = ‖Ax<sup>(k)</sup> − b‖<sub>∞</sub> ≤ ${tol}.
      La norma infinito es el máximo valor absoluto de las componentes. E<sub>k</sub> mide cuánto cambió la aproximación, <strong>no</strong> la distancia a la solución exacta; R<sub>k</sub> mide cuánto falla la aproximación al sustituirla en el sistema.
    </div>`;
  const vector = matrixHTML(last.x.map((v) => [fmt(v)]), { label: vecK(last.k) });

  if (run.status === 'converged') {
    return `
      <div class="result-box">
        <div class="result-label">Solución aproximada</div>
        <div class="result-value">${vecK(last.k)} ≈ (${last.x.map((v) => fmt(v)).join(', ')})</div>
        <div class="result-meta">${last.k} ${last.k === 1 ? 'iteración' : 'iteraciones'} · E<sub>${last.k}</sub> = ${fmt(last.change)} ≤ ${tol} · R<sub>${last.k}</sub> = ${fmt(last.residual)} ≤ ${tol}</div>
      </div>
      <div class="matrix-row">${vector}</div>
      ${criterion}`;
  }

  if (run.status === 'maxIter') {
    const fails = [last.change > sol.tol ? `E<sub>${last.k}</sub> = ${fmt(last.change)} > ${tol}` : '', last.residual > sol.tol ? `R<sub>${last.k}</sub> = ${fmt(last.residual)} > ${tol}` : ''].filter(Boolean).join(' y ');
    const mid = run.iterations[Math.max(1, Math.floor(last.k / 2))];
    const trend = last.k >= 4
      ? `<p class="note">Como referencia, el cambio pasó de E<sub>${mid.k}</sub> = ${fmt(mid.change)} a E<sub>${last.k}</sub> = ${fmt(last.change)}. Esto describe lo observado; no prueba convergencia ni divergencia.</p>`
      : '';
    return `
      <div class="result-box result-warn">
        <div class="result-label">Estado final</div>
        <div class="result-value small">Se alcanzó el máximo de iteraciones sin cumplir la tolerancia</div>
        <div class="result-meta">${sol.maxIter} iteraciones · ${fails}</div>
      </div>
      <p class="note">Última aproximación calculada (<strong>no</strong> cumple la tolerancia):</p>
      <div class="matrix-row">${vector}</div>
      ${trend}
      <p class="note">Puedes aumentar el máximo de iteraciones, cambiar el vector inicial o intentar reordenar las ecuaciones.</p>
      ${criterion}`;
  }

  return `
    <div class="result-box result-error">
      <div class="result-label">Estado final</div>
      <div class="result-value small">Cálculo detenido en la iteración ${run.failedAt}</div>
      <div class="result-meta">Se obtuvieron valores no finitos (desbordamiento numérico)</div>
    </div>
    <p class="note">Los valores crecieron fuera del rango representable, por lo que el cálculo se detuvo. No se obtuvo una aproximación que cumpla la tolerancia. Última aproximación finita (k = ${last.k}):</p>
    <div class="matrix-row">${vector}</div>
    ${criterion}`;
}

function renderCheck(sol) {
  const last = sol.run.iterations.at(-1);
  const Ax = matVec(sol.A, last.x);
  const rows = sol.A.map((row, i) => `<tr>
      <td>${i + 1}</td>
      <td class="math-cell">${row.map((a, j) => `${paren(a, fmtIn)}·${paren(last.x[j])}`).join(' + ')}</td>
      <td class="num-cell"><strong>${fmt(Ax[i])}</strong></td>
      <td class="num-cell">${fmtIn(sol.b[i])}</td>
      <td class="num-cell">${fmt(Ax[i] - sol.b[i])}</td>
    </tr>`).join('');
  const r = normInf(Ax.map((v, i) => v - sol.b[i]));
  return `
    <p class="note">Se sustituye ${vecK(last.k)} en cada ecuación y se compara con b${sol.run.status === 'converged' ? '' : ' (esta aproximación no cumplió la tolerancia)'}.</p>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>i</th><th>Σ a<sub>ij</sub>x<sub>j</sub></th><th>(Ax)<sub>i</sub></th><th>b<sub>i</sub></th><th>(Ax)<sub>i</sub> − b<sub>i</sub></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="formula">‖A${vecK(last.k)} − b‖<sub>∞</sub> = <strong>${fmt(r)}</strong></div>`;
}

/* =========================================================
   Gráfico SVG: cambio y residuo en escala logarítmica
   ========================================================= */

function renderChart(sol) {
  const its = sol.run.iterations;
  const W = 760, H = 420;
  const pad = { l: 72, r: 24, t: 56, b: 52 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const K = Math.max(its.at(-1).k, 1);

  const E = its.filter((it) => it.change !== null).map((it) => [it.k, it.change]);
  const R = its.map((it) => [it.k, it.residual]);
  const values = [...E, ...R].map((p) => p[1]);
  const positives = values.filter((v) => v > 0).concat(sol.tol);
  const hasZero = values.some((v) => v === 0);

  let lo = Math.floor(Math.log10(Math.min(...positives)));
  let hi = Math.ceil(Math.log10(Math.max(...positives)));
  if (hasZero) lo -= 1; // banda inferior reservada para los ceros
  if (hi <= lo) hi = lo + 1;
  const floorValue = 10 ** lo;

  const sx = (k) => pad.l + (k / K) * pw;
  const sy = (v) => pad.t + (1 - (Math.log10(v > 0 ? v : floorValue) - lo) / (hi - lo)) * ph;
  const r2 = (v) => Math.round(v * 100) / 100;

  const decadeStep = Math.ceil((hi - lo) / 8);
  const yTicks = [];
  for (let e = lo; e <= hi; e += decadeStep) yTicks.push(e);
  const xt = niceTicks(0, K, 8);
  const xStep = Math.max(1, xt.step);
  const xTicks = [];
  for (let k = 0; k <= K; k += xStep) xTicks.push(Math.round(k));

  const grid = [
    ...xTicks.map((k) => `<line class="grid" x1="${r2(sx(k))}" x2="${r2(sx(k))}" y1="${pad.t}" y2="${pad.t + ph}"/>
      <text class="tick" x="${r2(sx(k))}" y="${pad.t + ph + 20}" text-anchor="middle">${tickLabel(k, xStep)}</text>`),
    ...yTicks.map((e) => `<line class="grid" x1="${pad.l}" x2="${pad.l + pw}" y1="${r2(sy(10 ** e))}" y2="${r2(sy(10 ** e))}"/>
      <text class="tick" x="${pad.l - 10}" y="${r2(sy(10 ** e)) + 4}" text-anchor="end">10<tspan dy="-6" font-size="9">${String(e).replace('-', MINUS)}</tspan></text>`),
  ].join('');

  const path = (pts) => pts.map(([k, v], i) => `${i ? 'L' : 'M'}${r2(sx(k))},${r2(sy(v))}`).join('');
  const markers = (pts, cls) => (pts.length > 60 ? '' : pts.map(([k, v]) =>
    `<circle class="${cls} ${v === 0 ? 'zero-pt' : ''}" cx="${r2(sx(k))}" cy="${r2(sy(v))}" r="3.5"><title>k = ${k}: ${v}</title></circle>`).join(''));

  const tolY = r2(sy(sol.tol));
  const legend = `
    <g transform="translate(${pad.l},26)"><line class="series-e" x1="0" x2="22" y1="0" y2="0"/><text x="30" y="4">Cambio E<tspan dy="4" font-size="9">k</tspan></text></g>
    <g transform="translate(${pad.l + 130},26)"><line class="series-r" x1="0" x2="22" y1="0" y2="0"/><text x="30" y="4">Residuo R<tspan dy="4" font-size="9">k</tspan></text></g>
    <g transform="translate(${pad.l + 270},26)"><line class="tol-line" x1="0" x2="22" y1="0" y2="0"/><text x="30" y="4">Tolerancia</text></g>`;

  return `
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cambio y residuo en escala logarítmica frente al número de iteración">
        <defs><clipPath id="jac-plot-clip"><rect x="${pad.l}" y="${pad.t - 4}" width="${pw}" height="${ph + 8}"/></clipPath></defs>
        <g class="legend">${legend}</g>
        ${grid}
        <rect class="frame" x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}"/>
        <g clip-path="url(#jac-plot-clip)">
          <line class="tol-line" x1="${pad.l}" x2="${pad.l + pw}" y1="${tolY}" y2="${tolY}"/>
          <path class="series-r" d="${path(R)}"/>
          <path class="series-e" d="${path(E)}"/>
          ${markers(R, 'pt-r')}${markers(E, 'pt-e')}
        </g>
        <text class="axis-label" x="${pad.l + pw / 2}" y="${H - 10}" text-anchor="middle">iteración k</text>
        <text class="axis-label" transform="translate(18 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">escala log₁₀</text>
      </svg>
    </div>
    <p class="note">Eje vertical logarítmico. E<sub>k</sub> empieza en k = 1 (en k = 0 no hay iteración anterior).${hasZero ? ' Los valores exactamente iguales a 0 no tienen logaritmo: se dibujan en el borde inferior (10' + toSup(String(lo)) + ').' : ''}</p>`;
}

/* =========================================================
   Eventos
   ========================================================= */

els.inputCard.addEventListener('input', (e) => {
  const t = e.target;
  const { kind } = t.dataset;
  if (kind) {
    const i = Number(t.dataset.i);
    if (kind === 'a') state.A[i][Number(t.dataset.j)] = t.value;
    else if (kind === 'b') state.b[i] = t.value;
    else if (kind === 'x0') state.x0[i] = t.value;
  }
  if (t.classList.contains('invalid')) {
    t.classList.remove('invalid');
    t.removeAttribute('aria-invalid');
    const msg = document.getElementById(`${t.id}-msg`);
    if (msg) msg.textContent = '';
  }
  if (t !== els.decimals && t !== els.pasteArea) markStale();
});

els.inputCard.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || !t.classList.contains('cell-input')) return;
  e.preventDefault();
  const cells = allCells();
  const next = cells[cells.indexOf(t) + 1];
  if (next) next.focus();
  else solve();
});

els.inputCard.addEventListener('paste', (e) => {
  const t = e.target;
  if (!t.classList.contains('cell-input')) return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (!/[\t\n]/.test(text.trim())) return;
  e.preventDefault();
  fillFromCell(splitPasted(text), t.dataset.kind, Number(t.dataset.i), Number(t.dataset.j));
});

els.size.addEventListener('change', () => {
  setSize(Number(els.size.value));
  clearErrors();
  markStale();
});

els.pasteApply.addEventListener('click', () => {
  const text = els.pasteArea.value;
  const res = text.trim() ? applyAugmentedPaste(text) : { ok: false, msg: 'Pega primero la matriz aumentada en el cuadro.' };
  els.pasteMsg.className = `inline-msg ${res.ok ? 'ok' : 'error'}`;
  els.pasteMsg.textContent = res.msg;
  if (res.ok) clearErrors();
});

els.decimals.addEventListener('change', () => {
  if (state.solution) renderResults();
});

[els.tol, els.maxIter].forEach((el) => el.addEventListener('keydown', (e) => e.key === 'Enter' && solve()));

els.solve.addEventListener('click', solve);

els.example.addEventListener('click', () => {
  state.A = EXAMPLE.A.map((r) => r.slice());
  state.b = EXAMPLE.b.slice();
  state.x0 = EXAMPLE.x0.slice();
  setSize(EXAMPLE.A.length);
  els.tol.value = EXAMPLE.tol;
  els.maxIter.value = EXAMPLE.maxIter;
  els.pasteMsg.textContent = '';
  solve();
});

els.clear.addEventListener('click', () => {
  state.solution = null;
  state.stale = false;
  state.pending = null;
  setSize(DEFAULT_N, { keep: false });
  els.tol.value = '0.0001';
  els.maxIter.value = '100';
  els.pasteArea.value = '';
  els.pasteMsg.textContent = '';
  clearErrors();
  renderEmpty();
});

els.results.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;

  if (action === 'toggle-iter') {
    const k = Number(btn.dataset.k);
    const row = btn.closest('tr');
    const existing = document.getElementById(`jac-iter-${k}`);
    if (existing) {
      existing.remove();
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'Ver';
      return;
    }
    row.insertAdjacentHTML('afterend', `<tr class="detail-row" id="jac-iter-${k}"><td colspan="${state.solution.n + 4}">
      <div class="detail-title">Iteración ${k}: de ${vecK(k - 1)} a ${vecK(k)}</div>${iterationDetail(state.solution, k)}</td></tr>`);
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Ocultar';
  } else if (action === 'show-all') {
    state.showAllRows = true;
    const card = document.getElementById('jac-step-7');
    card.innerHTML = card.querySelector('.step-head').outerHTML + renderTable(state.solution);
  } else if (action === 'reorder') {
    renderReorderProposal(btn.dataset.context);
  } else if (action === 'apply-perm') {
    applyPermutation(btn.dataset.perm.split(',').map(Number));
  } else if (action === 'cancel-perm') {
    const box = document.getElementById('jac-reorder-box');
    if (box) box.innerHTML = '';
  }
});

/* =========================================================
   Inicio
   ========================================================= */

els.size.innerHTML = Array.from({ length: MAX_N - MIN_N + 1 }, (_, k) => `<option value="${k + MIN_N}">${k + MIN_N} incógnitas</option>`).join('');
els.decimals.innerHTML = Array.from({ length: 9 }, (_, k) => `<option value="${k + 2}">${k + 2}</option>`).join('');
els.decimals.value = String(DEFAULT_DECIMALS);
setSize(DEFAULT_N, { keep: false });
renderEmpty();
