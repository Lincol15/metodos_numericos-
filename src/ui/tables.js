/* =========================================================
   Componentes de tabla reutilizables:
   - Editor de puntos i | xi | yi (con columna opcional «Usar»).
   - Importador de datos pegados con vista previa.
   - Tabla de resultados paginada (renderizado progresivo).
   ========================================================= */

import { esc } from '../shared/format.js';
import { parseTwoColumns } from '../utils/parsing.js';

let uid = 0;
const newRow = (x = '', y = '') => ({ id: ++uid, x, y });

/* ---------------- Editor de puntos ---------------- */

export function createPointEditor(root, { prefix, label, minRows = 2, maxRows, initialRows = 4, startIndex = 0, onChange }) {
  root.innerHTML = `
    <div class="block-head">
      <h3>${label}</h3>
      <span class="badge" data-role="count"></span>
    </div>
    <div class="table-scroll">
      <table class="points-table" data-role="table">
        <thead><tr>
          <th class="col-i" scope="col">i</th>
          <th scope="col">x<sub>i</sub></th>
          <th scope="col">y<sub>i</sub></th>
          <th class="col-use" scope="col">Usar</th>
          <th class="col-del"><span class="sr-only">Eliminar</span></th>
        </tr></thead>
        <tbody data-role="body"></tbody>
      </table>
    </div>
    <div class="row-actions">
      <button type="button" class="btn btn-ghost" data-role="add"><span aria-hidden="true">＋</span> Agregar fila</button>
    </div>`;

  const table = root.querySelector('[data-role="table"]');
  const body = root.querySelector('[data-role="body"]');
  const count = root.querySelector('[data-role="count"]');
  const addBtn = root.querySelector('[data-role="add"]');
  let rows = Array.from({ length: initialRows }, () => newRow());
  let use = null; // { isChecked(id), onToggle(id, checked), highlight(id) }

  const inputId = (id, f) => `${prefix}-${f}-${id}`;

  function render() {
    const n = rows.length;
    table.classList.toggle('manual', !!use);
    body.innerHTML = rows
      .map((r, i) => `
        <tr class="${use?.highlight?.(r.id) ? 'row-used' : ''}">
          <td class="col-i">${i + startIndex}</td>
          <td>
            <input class="cell-input" id="${inputId(r.id, 'x')}" data-id="${r.id}" data-field="x" inputmode="decimal" autocomplete="off"
              aria-label="x${i + startIndex}" aria-describedby="${inputId(r.id, 'x')}-msg" value="${esc(r.x)}" />
            <div class="field-msg" id="${inputId(r.id, 'x')}-msg"></div>
          </td>
          <td>
            <input class="cell-input" id="${inputId(r.id, 'y')}" data-id="${r.id}" data-field="y" inputmode="decimal" autocomplete="off"
              aria-label="y${i + startIndex}" aria-describedby="${inputId(r.id, 'y')}-msg" value="${esc(r.y)}" />
            <div class="field-msg" id="${inputId(r.id, 'y')}-msg"></div>
          </td>
          <td class="col-use">
            <input type="checkbox" data-id="${r.id}" data-field="use" ${use?.isChecked(r.id) ? 'checked' : ''} aria-label="Usar el punto ${i + startIndex}" />
          </td>
          <td class="col-del">
            <button type="button" class="icon-btn" data-del="${r.id}" ${n <= minRows ? 'disabled' : ''} aria-label="Eliminar fila ${i + startIndex}" title="Eliminar fila ${i + startIndex}">✕</button>
          </td>
        </tr>`)
      .join('');
    count.textContent = `n = ${n} (máx. ${maxRows})`;
    addBtn.disabled = n >= maxRows;
  }

  body.addEventListener('input', (e) => {
    const t = e.target;
    const row = rows.find((r) => r.id === Number(t.dataset.id));
    if (!row) return;
    if (t.dataset.field === 'use') {
      use?.onToggle(row.id, t.checked);
      return;
    }
    row[t.dataset.field] = t.value;
    t.classList.remove('invalid');
    t.removeAttribute('aria-invalid');
    const msg = document.getElementById(`${t.id}-msg`);
    if (msg) msg.textContent = '';
    onChange?.('edit');
  });

  body.addEventListener('click', (e) => {
    const id = Number(e.target.closest('[data-del]')?.dataset.del);
    if (!id || rows.length <= minRows) return;
    rows = rows.filter((r) => r.id !== id);
    render();
    onChange?.('structure');
  });

  body.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key !== 'Enter' || !t.classList.contains('cell-input')) return;
    e.preventDefault();
    const idx = rows.findIndex((r) => r.id === Number(t.dataset.id));
    if (idx + 1 >= rows.length) {
      if (rows.length >= maxRows) return;
      rows.push(newRow());
      render();
      onChange?.('structure');
    }
    document.getElementById(inputId(rows[idx + 1].id, t.dataset.field))?.focus();
  });

  addBtn.addEventListener('click', () => {
    if (rows.length >= maxRows) return;
    rows.push(newRow());
    render();
    onChange?.('structure');
    document.getElementById(inputId(rows.at(-1).id, 'x'))?.focus();
  });

  render();

  return {
    getRows: () => rows.map((r) => ({ ...r })),
    setRows(list) {
      rows = list.slice(0, maxRows).map((r) => newRow(String(r.x), String(r.y)));
      while (rows.length < minRows) rows.push(newRow());
      render();
      onChange?.('structure');
    },
    reset(n = initialRows) {
      rows = Array.from({ length: n }, () => newRow());
      render();
    },
    setUse(config) {
      use = config;
      render();
    },
    render,
    clearErrors() {
      root.querySelectorAll('.invalid').forEach((el) => { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
      root.querySelectorAll('.field-msg').forEach((el) => (el.textContent = ''));
    },
    setError(id, field, text) {
      const el = document.getElementById(inputId(id, field));
      if (!el) return;
      el.classList.add('invalid');
      el.setAttribute('aria-invalid', 'true');
      document.getElementById(`${el.id}-msg`).textContent = text;
    },
    firstError: () => root.querySelector('.invalid'),
  };
}

/* ---------------- Importador con vista previa ---------------- */

export function createPasteImporter(root, { prefix, maxRows, onImport }) {
  root.innerHTML = `
    <details class="paste-box">
      <summary>Pegar datos desde Excel</summary>
      <p class="hint">Dos columnas x, y. Delimitadores: tabulación, punto y coma, espacios o coma.
        Si usas coma decimal, separa con tabulación o punto y coma; con la coma como delimitador se exige punto decimal.</p>
      <label class="sr-only" for="${prefix}-paste">Datos pegados</label>
      <textarea id="${prefix}-paste" rows="5" spellcheck="false" placeholder="0\t2,1&#10;1\t7,7&#10;2\t13,6"></textarea>
      <div class="paste-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-role="preview">Vista previa</button>
      </div>
      <div class="paste-preview" data-role="out" aria-live="polite"></div>
    </details>`;

  const area = root.querySelector('textarea');
  const out = root.querySelector('[data-role="out"]');
  let pending = null;

  root.querySelector('[data-role="preview"]').addEventListener('click', () => {
    if (!area.value.trim()) {
      out.innerHTML = '<p class="inline-msg error">Pega primero los datos en el cuadro.</p>';
      pending = null;
      return;
    }
    const res = parseTwoColumns(area.value);
    const valid = res.lines.filter((l) => l.ok);
    const invalid = res.lines.length - valid.length;
    const tooMany = valid.length > maxRows;
    pending = tooMany || !valid.length ? null : valid.map((l) => ({ x: l.cells[0], y: l.cells[1], xv: l.x, yv: l.y }));

    const notes = [`Delimitador detectado: <strong>${res.delimiterLabel}</strong>`];
    if (res.header) notes.push(`línea ${res.header.lineNo} tomada como encabezado («${esc(res.header.raw.trim())}»)`);
    if (res.indexColumn) notes.push('se omitió la primera columna (índice i)');
    const rows = res.lines.map((l) => `
      <tr class="${l.ok ? '' : 'bad-row'}">
        <td>${l.lineNo}</td><td>${l.ok ? l.x : esc(l.cells[0] ?? '')}</td><td>${l.ok ? l.y : esc(l.cells[1] ?? '')}</td>
        <td>${l.ok ? '<span class="tag tag-ok">Válida</span>' : `<span class="tag tag-bad">Inválida</span> ${esc(l.error)}`}</td>
      </tr>`).join('');

    let action;
    if (!valid.length) action = '<p class="inline-msg error">No hay líneas válidas para importar.</p>';
    else if (tooMany) action = `<p class="inline-msg error">Hay ${valid.length} filas válidas y el máximo es ${maxRows}. Reduce los datos antes de importar.</p>`;
    else action = `<div class="inline-actions">
        <button type="button" class="btn btn-primary btn-sm" data-role="import">Importar ${valid.length} ${valid.length === 1 ? 'fila válida' : 'filas válidas'}${invalid ? ` y omitir ${invalid} ${invalid === 1 ? 'inválida' : 'inválidas'}` : ''}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-role="cancel">Cancelar</button>
      </div>`;

    out.innerHTML = `
      <p class="hint small">${notes.join(' · ')}. ${res.lines.length} líneas de datos: ${valid.length} válidas, ${invalid} inválidas.</p>
      <div class="table-scroll"><table class="data-table compact">
        <thead><tr><th>Línea</th><th>x</th><th>y</th><th>Estado</th></tr></thead><tbody>${rows}</tbody>
      </table></div>
      ${invalid ? '<p class="inline-msg error">Las líneas inválidas no se importarán. Corrígelas en el cuadro y vuelve a generar la vista previa si las necesitas.</p>' : ''}
      ${action}`;
  });

  out.addEventListener('click', (e) => {
    const role = e.target.closest('[data-role]')?.dataset.role;
    if (role === 'import' && pending) {
      onImport(pending);
      out.innerHTML = `<p class="inline-msg ok">${pending.length} filas importadas. Los datos anteriores se reemplazaron.</p>`;
      pending = null;
    } else if (role === 'cancel') {
      out.innerHTML = '';
      pending = null;
    }
  });

  return { clear() { area.value = ''; out.innerHTML = ''; pending = null; } };
}

/* ---------------- Tabla de resultados paginada ---------------- */

const pages = new Map();
let pageUid = 0;

/**
 * Tabla HTML que muestra `pageSize` filas y un botón «Mostrar más».
 * rows: arrays de celdas HTML; foot: fila final opcional (sumatorias).
 */
export function pagedTable({ headers, rows, foot = null, pageSize = 60, cls = '' }) {
  const id = `pg-${++pageUid}`;
  const first = rows.slice(0, pageSize);
  const rest = rows.slice(pageSize);
  if (rest.length) pages.set(id, { rest, pageSize });
  const tr = (r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  return `
    <div class="table-scroll"><table class="data-table ${cls}" id="${id}">
      <thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
      <tbody>${first.map(tr).join('')}</tbody>
      ${foot ? `<tfoot><tr>${foot.map((c) => `<td>${c}</td>`).join('')}</tr></tfoot>` : ''}
    </table></div>
    ${rest.length ? `<button type="button" class="btn btn-ghost btn-sm more-btn" data-more="${id}">Mostrar ${Math.min(pageSize, rest.length)} filas más (quedan ${rest.length})</button>` : ''}`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-more]');
  if (!btn) return;
  const entry = pages.get(btn.dataset.more);
  const table = document.getElementById(btn.dataset.more);
  if (!entry || !table) return;
  const chunk = entry.rest.splice(0, entry.pageSize);
  table.tBodies[0].insertAdjacentHTML('beforeend', chunk.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join(''));
  if (entry.rest.length) btn.textContent = `Mostrar ${Math.min(entry.pageSize, entry.rest.length)} filas más (quedan ${entry.rest.length})`;
  else { btn.remove(); pages.delete(btn.dataset.more); }
});

/** Muestra todas las filas pendientes (para imprimir). */
export function expandAllPages(scope) {
  scope.querySelectorAll('[data-more]').forEach((btn) => {
    while (btn.isConnected) btn.click();
  });
}
