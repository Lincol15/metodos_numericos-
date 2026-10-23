/* =========================================================
   Lectura y formato de números, compartido por todos los métodos.
   El cálculo nunca se redondea: estas funciones solo presentan.
   ========================================================= */

export const MINUS = '−';

/**
 * Lee un número escrito por el usuario. Acepta punto o coma decimal,
 * signo y notación científica; no acepta separadores de miles ni espacios.
 * Devuelve { value } | { empty: true } | { error: true }.
 */
export function parseNumber(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/[−‒–]/g, '-');
  if (!s) return { empty: true };
  if ((s.match(/[.,]/g) || []).length > 1) return { error: true };
  const norm = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(norm)) return { error: true };
  const value = Number(norm);
  return Number.isFinite(value) ? { value } : { error: true, nonFinite: true };
}

/** Mensaje corto para un campo según el resultado de parseNumber. */
export function numberError(p, emptyMsg = 'Campo requerido') {
  if (p.empty) return emptyMsg;
  if (p.nonFinite) return 'Fuera de rango';
  if (p.error) return 'Número no válido';
  return '';
}

/** Divide texto copiado de Excel en filas de celdas (tabulador, «;» o espacios). */
export function splitPasted(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const cells = l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.trim().split(/\s+/);
      return cells.map((c) => c.trim());
    });
}

/** Resultado redondeado a `dec` decimales (HTML, con signo menos tipográfico). */
export function formatNumber(v, dec) {
  if (!Number.isFinite(v)) return String(v);
  if (Object.is(v, -0)) v = 0;
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e12 || a < 10 ** -dec)) {
    const [mant, exp] = v.toExponential(Math.max(dec - 1, 1)).split('e');
    return `${mant.replace('-', MINUS)}<span class="sci">×10<sup>${Number(exp).toString().replace('-', MINUS)}</sup></span>`;
  }
  const s = v.toFixed(dec);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace('-', MINUS);
}

/** Valor ingresado: se muestra tal cual, sin ceros de relleno. */
export function formatInput(v) {
  if (Object.is(v, -0)) v = 0;
  const s = String(v);
  if (s.includes('e')) return formatNumber(v, 6);
  return s.replace('-', MINUS);
}

/** Suma con signos fusionados (evita "+ −"). items: [{ v, html: (abs) => string }] */
export function signedSum(items) {
  return items
    .map(({ v, html }, k) => {
      const body = html(Math.abs(v));
      if (k === 0) return v < 0 ? `${MINUS}${body}` : body;
      return ` ${v < 0 ? MINUS : '+'} ${body}`;
    })
    .join('');
}

export const frac = (num, den) =>
  `<span class="frac"><span class="num">${num}</span><span class="den">${den}</span></span>`;

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const toSub = (n) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]);
export const toSup = (s) =>
  String(s).replace(/[\d()+−-]/g, (c) => ({ '(': '⁽', ')': '⁾', '+': '⁺', '−': '⁻', '-': '⁻' })[c] ?? '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]);
