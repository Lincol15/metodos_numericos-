/* =========================================================
   Fórmulas con KaTeX y formato de números para LaTeX.
   ========================================================= */

import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Renderiza LaTeX a HTML (en línea o en bloque). */
export const tex = (src, display = false) =>
  katex.renderToString(src, { throwOnError: false, displayMode: display, output: 'html', strict: 'ignore' });

/** Bloque de fórmula desplazable horizontalmente. */
export const texBlock = (src) => `<div class="tex-block">${tex(src, true)}</div>`;

/** Número redondeado a `dec` decimales en LaTeX (solo presentación). */
export function texNum(v, dec) {
  if (v === null || v === undefined) return '\\text{—}';
  if (!Number.isFinite(v)) return '\\text{no finito}';
  if (Object.is(v, -0)) v = 0;
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e12 || a < 10 ** -dec)) {
    const [m, e] = v.toExponential(Math.max(dec - 1, 1)).split('e');
    return `${m}\\times 10^{${Number(e)}}`;
  }
  const s = v.toFixed(dec);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** Valor ingresado tal cual, sin ceros de relleno. */
export function texIn(v) {
  if (Object.is(v, -0)) v = 0;
  const s = String(v);
  if (!s.includes('e')) return s;
  const [m, e] = s.split('e');
  return `${m}\\times 10^{${Number(e)}}`;
}

/** Entre paréntesis si es negativo. */
export const texParen = (str, v) => (v < 0 ? `\\left(${str}\\right)` : str);

/** Suma con signos fusionados: items [{ v, body: (absText) => string, fmt }] */
export function texSignedSum(items) {
  if (!items.length) return '0';
  return items
    .map(({ v, body }, k) => {
      const b = body(Math.abs(v));
      if (k === 0) return v < 0 ? `-${b}` : b;
      return ` ${v < 0 ? '-' : '+'} ${b}`;
    })
    .join('');
}

/** (x − c) con signo correcto: (x + 2), (x − 3.5), x. */
export function texFactor(variable, c, fmt = texIn) {
  if (c === 0) return variable;
  return `(${variable} ${c < 0 ? '+' : '-'} ${fmt(Math.abs(c))})`;
}

/** a − b fusionando signos, para sustituciones numéricas. */
export const texMinus = (aTex, b, fmt = texIn) => (b < 0 ? `${aTex} + ${fmt(-b)}` : `${aTex} - ${fmt(b)}`);

/** Matriz con corchetes; `split` dibuja una barra vertical tras esa columna. */
export function texMatrix(rows, { split = null } = {}) {
  const cols = rows[0].length;
  const spec = Array.from({ length: cols }, (_, j) => (split !== null && j === split - 1 ? 'r|' : 'r')).join('');
  const body = rows.map((r) => r.join(' & ')).join(' \\\\ ');
  return `\\left[\\begin{array}{${spec}} ${body} \\end{array}\\right]`;
}

/** Vector columna. */
export const texColumn = (items) => texMatrix(items.map((v) => [v]));

/** x^k presentado: 1, x, x^2… */
export const texPow = (variable, k) => (k === 0 ? '' : k === 1 ? variable : `${variable}^{${k}}`);
