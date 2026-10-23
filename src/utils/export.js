/* =========================================================
   Exportación: copiar texto, descargar CSV y vista imprimible.
   ========================================================= */

import { GROUP, COURSE, TEACHER, TEAM } from '../data/credits.js';
import { esc } from '../shared/format.js';

/** Copia texto al portapapeles. Devuelve true si se logró. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Texto CSV (coma como delimitador, punto decimal, precisión completa). */
export const toCSV = (headers, rows) => [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

/** Descarga un CSV con BOM UTF-8 para que Excel muestre bien los acentos. */
export function downloadCSV(filename, headers, rows) {
  const blob = new Blob(['﻿', toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Abre el diálogo de impresión con el contenido indicado (solo se imprime #print-root). */
export function printReport(html) {
  const root = document.getElementById('print-root');
  root.innerHTML = `<div class="print-credits"><strong>Laboratorio Numérico, grupo ${esc(GROUP)}</strong><br>
    Curso: ${esc(COURSE)}. Docente: ${esc(TEACHER)}.<br>
    Integrantes: ${TEAM.map(esc).join(', ')}.</div>${html}`;
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Copia del contenedor de resultados apta para imprimir: abre desplegables y convierte lienzos en imágenes. */
export function printableClone(container) {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('details').forEach((d) => (d.open = true));
  clone.querySelectorAll('[hidden]').forEach((el) => el.removeAttribute('hidden'));
  clone.querySelectorAll('.no-print, button, .plot-toolbar').forEach((el) => el.remove());
  const originals = container.querySelectorAll('canvas');
  clone.querySelectorAll('canvas').forEach((c, i) => {
    const img = document.createElement('img');
    img.src = originals[i].toDataURL('image/png');
    img.alt = originals[i].getAttribute('aria-label') ?? 'Gráfica';
    img.className = 'print-chart';
    c.replaceWith(img);
  });
  return clone.innerHTML;
}
