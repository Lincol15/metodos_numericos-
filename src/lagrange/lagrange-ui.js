/* =========================================================
   Lagrange interpolante: entradas, selección de nodos, desarrollo y eventos.
   Los cálculos viven en src/math/lagrange.js.
   ========================================================= */

import { parseNumber, numberError, esc } from '../shared/format.js';
import { selectNearestNodes, lagrangeInterpolation, makeInterpolant } from '../math/lagrange.js';
import { copyText, downloadCSV, printReport, printableClone } from '../utils/export.js';
import { LAGRANGE_EXAMPLE } from '../data/examples.js';
import { createPointEditor, createPasteImporter, pagedTable, expandAllPages } from '../ui/tables.js';
import { tex, texBlock, texNum, texIn, texParen, texSignedSum, texFactor, texMinus } from '../ui/formulas.js';
import { mountPlot, sampleCurve, paddedRange, curveStyle, pointStyle, PALETTE } from '../ui/charts.js';

const MAX_ROWS = 50;
const DEFAULT_DECIMALS = 7;
const STEP_TITLES = ['Nodos', 'Construcción', 'Funciones base', 'Contribuciones', 'Suma final', 'Comprobaciones'];

const $ = (s) => document.querySelector(s);
const els = {
  target: $('#lag-target'),
  targetMsg: $('#lag-target-msg'),
  real: $('#lag-real'),
  realMsg: $('#lag-real-msg'),
  degrees: $('#lag-degrees'),
  degreesHint: $('#lag-degrees-hint'),
  auto: $('#lag-auto'),
  manual: $('#lag-manual'),
  manualBox: $('#lag-manual-box'),
  manualDegree: $('#lag-manual-degree'),
  manualHint: $('#lag-manual-hint'),
  decimals: $('#lag-decimals'),
  formMsg: $('#lag-form-msg'),
  calc: $('#lag-calc'),
  example: $('#lag-example'),
  clear: $('#lag-clear'),
  results: $('#lag-results'),
};

const state = {
  degrees: new Set([1]),
  manual: new Map(), // grado → Set(id de fila)
  result: null,
  stale: false,
  view: { degree: null, step: 0, all: false },
};

let DEC = DEFAULT_DECIMALS;
const N = (v) => texNum(v, DEC);
const plain = (v) => (v === null || v === undefined ? '—' : Number.isFinite(v) ? texNum(v, DEC).replace(/\\times 10\^\{(-?\d+)\}/, 'e$1') : 'no finito');
const isManual = () => els.manual.checked;

const editor = createPointEditor($('#lag-points'), {
  prefix: 'lag', label: 'Datos (xᵢ, yᵢ)', maxRows: MAX_ROWS, initialRows: 4, startIndex: 0,
  onChange: (kind) => {
    if (kind === 'structure') syncStructure();
    markStale();
  },
});
const importer = createPasteImporter($('#lag-paste'), {
  prefix: 'lag', maxRows: MAX_ROWS,
  onImport: (rows) => { editor.setRows(rows); els.formMsg.textContent = ''; },
});

/* ---------------- Grados y selección manual ---------------- */

const maxDegree = () => editor.getRows().length - 1;

function syncStructure() {
  const max = maxDegree();
  state.degrees = new Set([...state.degrees].filter((g) => g <= max));
  const ids = new Set(editor.getRows().map((r) => r.id));
  state.manual.forEach((set, g) => {
    if (g > max) state.manual.delete(g);
    else set.forEach((id) => !ids.has(id) && set.delete(id));
  });
  renderDegreeChips();
  renderManualControls();
}

function renderDegreeChips() {
  const max = maxDegree();
  els.degrees.innerHTML = Array.from({ length: max }, (_, k) => {
    const g = k + 1;
    return `<label class="chip"><input type="checkbox" value="${g}" ${state.degrees.has(g) ? 'checked' : ''} /><span>${g}</span></label>`;
  }).join('');
  els.degreesHint.textContent = `Grados de 1 a n − 1 = ${max}. Elige uno o varios para comparar; el grado g usa g + 1 nodos.`;
}

function renderManualControls() {
  const manual = isManual();
  els.manualBox.hidden = !manual;
  if (!manual) {
    editor.setUse(null);
    return;
  }
  const degrees = [...state.degrees].sort((a, b) => a - b);
  const current = Number(els.manualDegree.value);
  els.manualDegree.innerHTML = degrees.map((g) => `<option value="${g}">Grado ${g} (${g + 1} nodos)</option>`).join('');
  if (degrees.includes(current)) els.manualDegree.value = String(current);
  const g = Number(els.manualDegree.value);
  if (!degrees.length) {
    els.manualHint.textContent = 'Selecciona primero al menos un grado.';
    editor.setUse(null);
    return;
  }
  if (!state.manual.has(g)) state.manual.set(g, new Set());
  const set = state.manual.get(g);
  editor.setUse({
    isChecked: (id) => set.has(id),
    highlight: (id) => set.has(id),
    onToggle: (id, checked) => {
      if (checked) set.add(id); else set.delete(id);
      updateManualHint();
      markStale();
      editor.render();
    },
  });
  updateManualHint();
}

function manualStatus(g) {
  const k = state.manual.get(g)?.size ?? 0;
  const need = g + 1;
  if (k === need) return { ok: true, text: `Grado ${g}: ${k} de ${need} nodos seleccionados ✔` };
  return { ok: false, text: `Grado ${g}: ${k} de ${need} seleccionados — ${k < need ? `faltan ${need - k}` : `sobran ${k - need}`}` };
}

function updateManualHint() {
  const lines = [...state.degrees].sort((a, b) => a - b).map(manualStatus);
  els.manualHint.innerHTML = lines.map((s) => `<div class="${s.ok ? 'ok' : 'warn'}">${s.text}</div>`).join('');
}

/* ---------------- Lectura y validación ---------------- */

function markStale() {
  if (!state.result || state.stale) return;
  state.stale = true;
  els.results.classList.add('is-stale');
  els.results.querySelectorAll('.export-btn').forEach((b) => (b.disabled = true));
  els.results.insertAdjacentHTML('afterbegin', staleBanner());
}
const staleBanner = () =>
  '<div class="stale-banner" role="status">Las entradas cambiaron. Estos resultados ya no son vigentes: presiona <strong>Calcular</strong> para actualizarlos. La exportación está desactivada.</div>';

function fieldError(input, msgEl, text) {
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
  msgEl.textContent = text;
}

function readInputs() {
  editor.clearErrors();
  [els.target, els.real].forEach((el) => { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
  els.targetMsg.textContent = '';
  els.realMsg.textContent = '';
  els.formMsg.textContent = '';

  const rows = editor.getRows();
  const points = rows.map((r) => {
    const px = parseNumber(r.x);
    const py = parseNumber(r.y);
    if (numberError(px)) editor.setError(r.id, 'x', numberError(px, 'Requerido'));
    if (numberError(py)) editor.setError(r.id, 'y', numberError(py, 'Requerido'));
    return { id: r.id, x: px.value, y: py.value };
  });
  const seen = new Map();
  points.forEach((p, i) => {
    if (p.x === undefined) return;
    if (seen.has(p.x)) {
      const j = seen.get(p.x);
      editor.setError(p.id, 'x', `Nodo repetido (igual a i = ${j})`);
      editor.setError(points[j].id, 'x', `Nodo repetido (igual a i = ${i})`);
    } else seen.set(p.x, i);
  });

  const pt = parseNumber(els.target.value);
  if (numberError(pt)) fieldError(els.target, els.targetMsg, numberError(pt, 'Ingresa el valor de x a evaluar'));
  const pr = parseNumber(els.real.value);
  if (!pr.empty && numberError(pr)) fieldError(els.real, els.realMsg, numberError(pr));

  const errors = [];
  if (editor.firstError()) errors.push('Revisa los datos marcados en rojo. Los nodos deben tener x distintos y los campos vacíos no se toman como cero.');
  if (numberError(pt) || (!pr.empty && numberError(pr))) errors.push('Revisa el valor objetivo y el valor real.');
  const degrees = [...state.degrees].sort((a, b) => a - b);
  if (!degrees.length) errors.push('Selecciona al menos un grado.');
  if (degrees.some((g) => g < 1 || g > rows.length - 1)) errors.push(`Los grados deben estar entre 1 y n − 1 = ${rows.length - 1}.`);
  if (isManual()) degrees.map(manualStatus).filter((s) => !s.ok).forEach((s) => errors.push(`Selección manual incorrecta. ${s.text}.`));

  if (errors.length) {
    els.formMsg.innerHTML = errors.map(esc).join('<br>');
    (editor.firstError() ?? document.querySelector("#panel-lagrange .input-panel .invalid"))?.focus();
    return null;
  }
  return { points, target: pt.value, real: pr.empty ? null : pr.value, degrees, mode: isManual() ? 'manual' : 'auto' };
}

function calculate() {
  const input = readInputs();
  if (!input) {
    if (state.result) markStale();
    return;
  }
  const xs = input.points.map((p) => p.x);
  const ys = input.points.map((p) => p.y);
  const runs = input.degrees.map((g) => {
    let idx;
    if (input.mode === 'auto') idx = selectNearestNodes(xs, input.target, g + 1);
    else {
      const set = state.manual.get(g);
      idx = input.points.map((p, i) => (set.has(p.id) ? i : -1)).filter((i) => i >= 0).sort((a, b) => xs[a] - xs[b]);
    }
    const res = lagrangeInterpolation(idx.map((i) => xs[i]), idx.map((i) => ys[i]), input.target);
    return { g, idx, ...res };
  });
  runs.forEach((run, k) => {
    run.diffPrev = k ? Math.abs(run.value - runs[k - 1].value) : null;
    if (input.real !== null) {
      run.absErr = Math.abs(input.real - run.value);
      run.relErr = input.real === 0 ? null : (run.absErr / Math.abs(input.real)) * 100;
    }
  });
  state.result = { ...input, xs, ys, runs };
  state.stale = false;
  state.view = { degree: runs[0].g, step: 0, all: false };
  render();
  if (window.matchMedia('(max-width: 979px)').matches) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- Presentación ---------------- */

const xsub = (i) => `x_{${i}}`;
const runOf = (g) => state.result.runs.find((r) => r.g === g);
const nodesText = (run) => run.nx.map((x) => texIn(x)).join(', ');

function render() {
  const r = state.result;
  DEC = Number(els.decimals.value);
  els.results.classList.toggle('is-stale', state.stale);
  els.results.innerHTML = `
    ${state.stale ? staleBanner() : ''}
    ${renderSummary(r)}
    <article class="card step"><header class="step-head"><span class="step-num">≈</span><h2>Gráfica</h2></header><div id="lag-plot"></div></article>
    <article class="card step"><header class="step-head"><span class="step-num">⇄</span><h2>Comparación y errores</h2>
      <button type="button" class="btn btn-ghost btn-sm export-btn head-btn" data-csv="comparison">Exportar CSV</button></header>
      ${renderComparison(r)}</article>
    <article class="card step" id="lag-dev"><header class="step-head"><span class="step-num">∑</span><h2>Desarrollo paso a paso</h2></header>
      <div id="lag-dev-body"></div></article>`;
  renderChart(r);
  renderDevelopment();
  if (state.stale) els.results.querySelectorAll('.export-btn').forEach((b) => (b.disabled = true));
}

function renderSummary(r) {
  const rows = r.runs.map((run) => `<li>${tex(`P_{${run.g}}(${texIn(r.target)}) \\approx ${N(run.value)}`)}
    <span class="tag ${run.extrapolation ? 'tag-warn' : 'tag-ok'}">${run.extrapolation ? 'Extrapolación' : 'Interpolación'}</span>
    ${run.agree && run.sumOk ? '' : '<span class="tag tag-bad">Revisar precisión</span>'}</li>`).join('');
  return `
    <div class="card summary-card">
      <div class="summary-head">
        <span class="status-pill status-ok-pill">Interpolación de Lagrange en x = ${esc(texIn(r.target))}</span>
        <div class="toolbar">
          <button type="button" class="btn btn-ghost btn-sm export-btn" data-action="copy">Copiar resultados</button>
          <button type="button" class="btn btn-ghost btn-sm export-btn" data-action="print">Vista imprimible</button>
        </div>
      </div>
      <ul class="pred-list">${rows}</ul>
      <p class="note">Nodos ${r.mode === 'auto' ? 'elegidos automáticamente: los g + 1 más cercanos al objetivo' : 'elegidos manualmente'}. Cada grado usa su propio conjunto fijo de nodos.</p>
      <span class="copy-msg" role="status"></span>
    </div>`;
}

function renderChart(r) {
  mountPlot(document.getElementById('lag-plot'), {
    id: 'lag-chart',
    baseRange: paddedRange([...r.xs, r.target]),
    ariaLabel: 'Datos, nodos y polinomios interpolantes de Lagrange',
    build: (a, b) => {
      const sets = [pointStyle('Todos los datos', '#94a3b8', r.xs.map((x, i) => ({ x, y: r.ys[i] })), { pointRadius: 4 })];
      r.runs.forEach((run, k) => {
        const color = PALETTE[k % PALETTE.length];
        sets.push(curveStyle(`P${run.g}(x)`, color, sampleCurve(makeInterpolant(run.nx, run.ny), a, b)));
        sets.push(pointStyle(`Nodos grado ${run.g}`, color, run.nx.map((x, i) => ({ x, y: run.ny[i] })), { pointRadius: 7, backgroundColor: 'transparent', borderWidth: 2.5 }));
        sets.push(pointStyle(`P${run.g}(${r.target}) calculado`, color, [{ x: r.target, y: run.value }], { pointStyle: 'star', pointRadius: 11, borderWidth: 2 }));
      });
      return { datasets: sets, keyY: [...r.ys, ...r.runs.map((run) => run.value)] };
    },
  });
}

function renderComparison(r) {
  const withReal = r.real !== null;
  const rows = r.runs.map((run) => [
    run.g,
    run.nx.map((x) => texIn(x)).join(', '),
    plain(run.value),
    run.diffPrev === null ? '—' : plain(run.diffPrev),
    run.extrapolation ? '<span class="tag tag-warn">Extrapolación</span>' : '<span class="tag tag-ok">Interpolación</span>',
    ...(withReal ? [plain(run.absErr), run.relErr === null ? 'No definido' : `${plain(run.relErr)} %`] : []),
  ]);
  const headers = ['Grado', 'Nodos utilizados', `P<sub>g</sub>(${texIn(r.target)})`, 'Diferencia entre aproximaciones', 'Tipo',
    ...(withReal ? ['Error absoluto', 'Error relativo %'] : [])];
  return `
    ${pagedTable({ headers, rows, cls: 'num-table' })}
    <p class="note">La «diferencia entre aproximaciones» compara cada grado con el grado anterior mostrado; <strong>no</strong> es el error verdadero. Un grado mayor no siempre produce mayor precisión.
    ${withReal ? `Con el valor real ${texIn(r.real)}: error absoluto = |valor real − aproximación| y error relativo = error absoluto / |valor real| × 100${r.real === 0 ? ' (no definido porque el valor real es 0)' : ''}.` : 'Si conoces el valor real, ingrésalo para calcular los errores.'}
    Se marca «Extrapolación» cuando el objetivo queda fuera del intervalo de los nodos seleccionados para ese grado, aunque esté dentro del rango de otros datos.</p>`;
}

/* ---------- Desarrollo de un grado: 6 pasos ---------- */

function stepNodes(run, r) {
  const sel = new Set(run.idx);
  let why;
  if (r.mode === 'auto') {
    const order = r.xs.map((x, i) => ({ i, x, d: Math.abs(x - r.target) }))
      .sort((p, q) => (Math.abs(p.d - q.d) <= 1e-12 * Math.max(1, Math.abs(r.target), ...r.xs.map(Math.abs)) ? p.x - q.x : p.d - q.d));
    why = `<p class="note">Selección automática: se ordenan los datos por distancia |x<sub>i</sub> − x*| al objetivo; en empates (con tolerancia relativa) va primero el menor x<sub>i</sub>. Se toman los ${run.g + 1} primeros y se ordenan de menor a mayor.</p>
      ${pagedTable({ headers: ['Orden', 'x<sub>i</sub>', '|x<sub>i</sub> − x*|', '¿Seleccionado?'], rows: order.map((o, k) => [k + 1, texIn(o.x), plain(o.d), sel.has(o.i) ? '<span class="tag tag-ok">Sí</span>' : '<span class="tag tag-muted">No</span>']) })}`;
  } else {
    why = `<p class="note">Selección manual: los ${run.g + 1} nodos marcados para el grado ${run.g}, ordenados de menor a mayor x.</p>`;
  }
  const rows = run.nx.map((x, i) => [i, texIn(x), texIn(run.ny[i]), run.idx[i]]);
  return `${why}
    <h3 class="sub-title">Nodos del grado ${run.g}</h3>
    ${pagedTable({ headers: ['i', 'x<sub>i</sub>', 'y<sub>i</sub>', 'Fila en la tabla'], rows })}
    <p class="note">Con ${run.g + 1} nodos el polinomio tiene grado <strong>como máximo</strong> ${run.g}: puede simplificarse a un grado menor (por ejemplo, si los nodos están alineados).
    ${run.extrapolation
      ? `<span class="tag tag-warn">Extrapolación</span> x* = ${texIn(r.target)} está fuera de [${texIn(run.nx[0])}, ${texIn(run.nx.at(-1))}].`
      : `<span class="tag tag-ok">Interpolación</span> x* = ${texIn(r.target)} está dentro de [${texIn(run.nx[0])}, ${texIn(run.nx.at(-1))}].`}</p>`;
}

function stepConstruction(run) {
  const g = run.g;
  const general = Array.from({ length: g + 1 }, (_, i) => `y_{${i}}L_{${i}}(x)`).join(' + ');
  const values = texSignedSum(run.ny.map((y, i) => ({ v: y, body: (abs) => `${texIn(abs)}\\,L_{${i}}(x)` })));
  return `
    ${texBlock(`P_{${g}}(x) = \\sum_{i=0}^{${g}} y_i\\,L_i(x) = ${general}`)}
    ${texBlock(`P_{${g}}(x) = ${values}`)}
    ${texBlock(`L_i(x) = \\prod_{j=0,\\ j\\neq i}^{${g}} \\frac{x - x_j}{x_i - x_j}`)}
    <p class="note">Cada L<sub>i</sub> vale 1 en x<sub>i</sub> y 0 en los demás nodos; por eso P<sub>${g}</sub> pasa por todos los nodos seleccionados.</p>`;
}

function basisDetail(run, c, t) {
  const sym = frac(c.factors.map((f) => `(x - ${xsub(f.j)})`).join(''), c.factors.map((f) => `(${xsub(c.i)} - ${xsub(f.j)})`).join(''));
  const nodes = frac(c.factors.map((f) => texFactor('x', f.xj)).join(''), c.factors.map((f) => `(${texMinus(texIn(c.xi), f.xj)})`).join(''));
  const subst = frac(c.factors.map((f) => `(${texMinus(texIn(t), f.xj)})`).join(''), c.factors.map((f) => `(${texMinus(texIn(c.xi), f.xj)})`).join(''));
  const diffs = frac(c.factors.map((f) => `(${N(f.num)})`).join(''), c.factors.map((f) => `(${N(f.den)})`).join(''));
  const prods = frac(N(c.num), N(c.den));
  return `
    <details class="gj-step basis" ${run.g <= 3 ? 'open' : ''}>
      <summary>${tex(`L_{${c.i}}(${texIn(t)}) = ${N(c.L)}`)}</summary>
      <div class="gj-body">
        <ol class="op-list">
          <li><span class="op-tag">Fórmula</span>${tex(`L_{${c.i}}(x) = ${sym}`)}</li>
          <li><span class="op-tag">Nodos</span>${tex(`L_{${c.i}}(x) = ${nodes}`)}</li>
          <li><span class="op-tag">x = ${esc(texIn(t))}</span>${tex(`L_{${c.i}}(${texIn(t)}) = ${subst}`)}</li>
          <li><span class="op-tag">Diferencias</span>${tex(`= ${diffs}`)}</li>
          <li><span class="op-tag">Productos</span>${tex(`= ${prods}`)}</li>
          <li><span class="op-tag">Resultado</span>${tex(`L_{${c.i}}(${texIn(t)}) = \\mathbf{${N(c.L)}}`)}</li>
        </ol>
      </div>
    </details>`;
}
const frac = (a, b) => `\\dfrac{${a}}{${b}}`;

function stepBases(run, r) {
  return `<p class="note">Para cada nodo se construye L<sub>i</sub> con los otros ${run.g} nodos y se evalúa en x* = ${texIn(r.target)}.${run.g > 3 ? ' Pulsa cada función para desplegar sus operaciones.' : ''}</p>
    ${run.contributions.map((c) => basisDetail(run, c, r.target)).join('')}`;
}

function stepContributions(run) {
  const rows = run.contributions.map((c) => [c.i, plain(c.L), texIn(c.y), plain(c.term)]);
  return `${pagedTable({ headers: ['i', 'L<sub>i</sub>(x*)', 'y<sub>i</sub>', 'y<sub>i</sub>·L<sub>i</sub>(x*)'], rows, foot: ['Σ', plain(run.sumL), '', plain(run.classic)], cls: 'num-table' })}
    <button type="button" class="btn btn-ghost btn-sm export-btn" data-csv="contrib-${run.g}">Exportar CSV de contribuciones</button>`;
}

function stepSum(run, r) {
  const t = texIn(r.target);
  const sum = texSignedSum(run.contributions.map((c) => ({ v: c.term, body: N })));
  return `
    ${texBlock(`P_{${run.g}}(${t}) = ${run.contributions.map((c) => `${texParen(texIn(c.y), c.y)}\\,${texParen(N(c.L), c.L)}`).join(' + ')}`)}
    ${texBlock(`= ${sum} = ${N(run.classic)}`)}
    ${run.nodeHit >= 0 ? `<p class="note">x* coincide con el nodo ${tex(xsub(run.nodeHit))}: la forma baricéntrica devuelve directamente ${tex(`y_{${run.nodeHit}} = ${texIn(run.ny[run.nodeHit])}`)}.</p>` : ''}
    <div class="result-box compact"><div class="result-label">Resultado (evaluación baricéntrica estable)</div>
      <div class="result-value">${tex(`P_{${run.g}}(${t}) = ${N(run.value)}`)}</div></div>`;
}

function stepChecks(run) {
  const rows = run.reproduction.map((p, i) => [i, texIn(p.x), texIn(p.y), plain(p.value), plain(p.diff), p.ok ? '<span class="tag tag-ok">✔</span>' : '<span class="tag tag-bad">✕</span>']);
  const reliable = run.finite && run.agree && run.sumOk && run.reproduction.every((p) => p.ok);
  return `
    <h3 class="sub-title">Suma de las funciones base</h3>
    ${texBlock(`\\sum_i L_i(x^*) = ${N(run.sumL)} \\approx 1`)}
    <p class="note">${run.sumOk ? '✔ Se cumple dentro de la tolerancia numérica.' : '✕ No se cumple dentro de la tolerancia: hay pérdida de precisión.'}</p>
    <h3 class="sub-title">Reproducción de los nodos</h3>
    ${pagedTable({ headers: ['i', 'x<sub>i</sub>', 'y<sub>i</sub>', 'P(x<sub>i</sub>)', '|P(x<sub>i</sub>) − y<sub>i</sub>|', '≤ tol'], rows, cls: 'num-table' })}
    <h3 class="sub-title">Forma clásica frente a forma baricéntrica</h3>
    ${texBlock(`\\text{Clásica} = ${N(run.classic)}, \\quad \\text{Baricéntrica} = ${N(run.bary)}, \\quad |\\Delta| = ${N(Math.abs(run.classic - run.bary))}`)}
    <p class="note">Tolerancia usada: ${tex(N(run.tol))} (relativa a máx|y<sub>i</sub>|).</p>
    ${reliable
      ? '<p class="alert alert-ok">Todas las comprobaciones se cumplen dentro de la tolerancia.</p>'
      : '<p class="alert alert-error"><strong>Cálculo poco fiable:</strong> alguna comprobación falla. Puede deberse a nodos muy cercanos entre sí, a valores de gran magnitud o a un grado alto; revisa los datos o usa menos nodos.</p>'}`;
}

function degreeSteps(run, r) {
  return [stepNodes(run, r), stepConstruction(run), stepBases(run, r), stepContributions(run), stepSum(run, r), stepChecks(run)];
}

function renderDevelopment() {
  const r = state.result;
  const body = document.getElementById('lag-dev-body');
  if (!body) return;
  const run = runOf(state.view.degree);
  const steps = degreeSteps(run, r);
  const { step, all } = state.view;
  body.innerHTML = `
    <div class="degree-tabs" role="tablist" aria-label="Grado a desarrollar">
      ${r.runs.map((x) => `<button type="button" role="tab" class="chip-btn" data-degree="${x.g}" aria-selected="${x.g === run.g}">Grado ${x.g}</button>`).join('')}
    </div>
    <div class="step-nav no-print" role="group" aria-label="Navegación de pasos">
      <button type="button" class="btn btn-ghost btn-sm" data-nav="prev" ${all || step === 0 ? 'disabled' : ''}>← Anterior</button>
      <span class="step-indicator">${all ? 'Todas las operaciones' : `Paso ${step + 1} de ${steps.length}: ${STEP_TITLES[step]}`}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-nav="next" ${all || step === steps.length - 1 ? 'disabled' : ''}>Siguiente →</button>
      <button type="button" class="btn btn-secondary btn-sm" data-nav="all">${all ? 'Ver paso a paso' : 'Ver todas las operaciones'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-nav="reset">Reiniciar explicación</button>
    </div>
    ${steps.map((html, k) => `
      <section class="dev-step" ${all || k === step ? '' : 'hidden'} aria-label="Paso ${k + 1}: ${STEP_TITLES[k]}">
        <h3 class="dev-title"><span class="step-num small">${k + 1}</span> ${STEP_TITLES[k]} · grado ${run.g}</h3>
        ${html}
      </section>`).join('')}`;
}

/* ---------------- Exportación ---------------- */

function csvFor(kind) {
  const r = state.result;
  if (kind === 'comparison') {
    const withReal = r.real !== null;
    return [
      ['grado', 'nodos', 'P(x*)', 'diferencia_entre_aproximaciones', 'tipo', ...(withReal ? ['error_absoluto', 'error_relativo_%'] : [])],
      r.runs.map((run) => [run.g, run.nx.join(' '), run.value, run.diffPrev ?? '', run.extrapolation ? 'extrapolación' : 'interpolación',
        ...(withReal ? [run.absErr, run.relErr ?? 'no definido'] : [])]),
    ];
  }
  const run = runOf(Number(kind.split('-')[1]));
  return [['i', 'x_i', 'L_i(x*)', 'y_i', 'y_i*L_i(x*)'], run.contributions.map((c) => [c.i, c.xi, c.L, c.y, c.term])];
}

function resultText() {
  const r = state.result;
  return [
    'Laboratorio Numérico — Interpolación de Lagrange',
    `Datos (n = ${r.xs.length}):`,
    ...r.xs.map((x, i) => `  ${i}\tx = ${x}\ty = ${r.ys[i]}`),
    `Objetivo x* = ${r.target}; selección ${r.mode === 'auto' ? 'automática' : 'manual'}${r.real !== null ? `; valor real = ${r.real}` : ''}`,
    ...r.runs.map((run) => `Grado ${run.g}: nodos [${run.nx.join(', ')}] → P${run.g}(${r.target}) = ${plain(run.value)} (${run.extrapolation ? 'extrapolación' : 'interpolación'})${run.diffPrev !== null ? `; diferencia entre aproximaciones = ${plain(run.diffPrev)}` : ''}${r.real !== null ? `; error abs = ${plain(run.absErr)}; error rel = ${run.relErr === null ? 'no definido' : `${plain(run.relErr)} %`}` : ''}`),
  ].join('\n');
}

function printView() {
  const r = state.result;
  const dev = document.getElementById('lag-dev');
  dev.classList.add("no-print"); // el desarrollo se imprime completo, grado por grado, más abajo
  expandAllPages(els.results);
  const top = printableClone(els.results);
  dev.classList.remove("no-print");
  const all = r.runs.map((run) => `<h2>Desarrollo — grado ${run.g}</h2>${degreeSteps(run, r).map((h, k) => `<h3>${k + 1}. ${STEP_TITLES[k]}</h3>${h}`).join('')}`).join('');
  const data = r.xs.map((x, i) => `<tr><td>${i}</td><td>${x}</td><td>${r.ys[i]}</td></tr>`).join('');
  printReport(`
    <h1>Laboratorio Numérico — Interpolación de Lagrange</h1>
    <h2>Datos</h2>
    <table class="data-table"><thead><tr><th>i</th><th>xi</th><th>yi</th></tr></thead><tbody>${data}</tbody></table>
    <h2>Configuración</h2>
    <p>Objetivo x* = ${r.target} · Grados: ${r.degrees.join(', ')} · Selección ${r.mode === 'auto' ? 'automática' : 'manual'} · Valor real: ${r.real ?? 'no ingresado'} · Decimales: ${DEC}</p>
    <h2>Resultados</h2>
    ${top}
    <div class="print-expand">${all}</div>`);
}

/* ---------------- Eventos ---------------- */

els.results.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn || !state.result) return;
  if (btn.dataset.degree) {
    state.view = { degree: Number(btn.dataset.degree), step: 0, all: state.view.all };
    renderDevelopment();
  } else if (btn.dataset.nav) {
    const v = state.view;
    if (btn.dataset.nav === 'prev') v.step = Math.max(0, v.step - 1);
    if (btn.dataset.nav === 'next') v.step = Math.min(STEP_TITLES.length - 1, v.step + 1);
    if (btn.dataset.nav === 'all') v.all = !v.all;
    if (btn.dataset.nav === 'reset') { v.step = 0; v.all = false; }
    renderDevelopment();
    document.querySelector(`#lag-dev [data-nav="${btn.dataset.nav}"]`)?.focus();
  } else if (btn.dataset.csv && !state.stale) {
    const [headers, rows] = csvFor(btn.dataset.csv);
    downloadCSV(`lagrange-${btn.dataset.csv}.csv`, headers, rows);
  } else if (btn.dataset.action === 'copy' && !state.stale) {
    const ok = await copyText(resultText());
    const msg = els.results.querySelector('.copy-msg');
    if (msg) msg.textContent = ok ? 'Resultados copiados al portapapeles.' : 'No se pudo copiar.';
  } else if (btn.dataset.action === 'print' && !state.stale) {
    printView();
  }
});

els.degrees.addEventListener('change', (e) => {
  const g = Number(e.target.value);
  if (e.target.checked) state.degrees.add(g); else state.degrees.delete(g);
  renderManualControls();
  markStale();
});

[els.auto, els.manual].forEach((r) => r.addEventListener('change', () => { renderManualControls(); markStale(); }));
els.manualDegree.addEventListener('change', renderManualControls);

[[els.target, els.targetMsg], [els.real, els.realMsg]].forEach(([el, msg]) => el.addEventListener('input', () => {
  el.classList.remove('invalid');
  el.removeAttribute('aria-invalid');
  msg.textContent = '';
  markStale();
}));
els.target.addEventListener('keydown', (e) => e.key === 'Enter' && calculate());
els.decimals.addEventListener('change', () => state.result && render());
els.calc.addEventListener('click', calculate);

els.example.addEventListener('click', () => {
  editor.setRows(LAGRANGE_EXAMPLE.points);
  els.target.value = LAGRANGE_EXAMPLE.target;
  els.real.value = '';
  els.auto.checked = true;
  state.degrees = new Set(LAGRANGE_EXAMPLE.degrees);
  syncStructure();
  calculate();
});

els.clear.addEventListener('click', () => {
  state.result = null;
  state.stale = false;
  state.degrees = new Set([1]);
  state.manual = new Map();
  els.auto.checked = true;
  editor.reset(4);
  editor.clearErrors();
  importer.clear();
  els.target.value = '';
  els.real.value = '';
  els.formMsg.textContent = '';
  els.targetMsg.textContent = '';
  els.realMsg.textContent = '';
  syncStructure();
  renderEmpty();
});

function renderEmpty() {
  els.results.classList.remove('is-stale');
  els.results.innerHTML = `
    <div class="card empty-state">
      <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M6 44 C18 10, 30 10, 38 30 S54 54, 60 22" /><circle cx="14" cy="26" r="3.5"/><circle cx="30" cy="16" r="3.5"/><circle cx="44" cy="40" r="3.5"/><circle cx="58" cy="26" r="3.5"/></svg></div>
      <h2>Aquí verás la interpolación y su desarrollo</h2>
      <p>Ingresa los nodos (x<sub>i</sub>, y<sub>i</sub>), el valor objetivo y los grados a comparar. Luego presiona <strong>Calcular</strong>.</p>
      <ol class="empty-steps">
        <li>Nodos seleccionados</li><li>Construcción de P<sub>g</sub></li><li>Funciones base L<sub>i</sub></li>
        <li>Contribuciones</li><li>Suma final</li><li>Comprobaciones</li>
      </ol>
    </div>`;
}

/* ---------------- Inicio ---------------- */

els.decimals.innerHTML = Array.from({ length: 9 }, (_, k) => `<option value="${k + 2}">${k + 2}</option>`).join('');
els.decimals.value = String(DEFAULT_DECIMALS);
syncStructure();
renderEmpty();
