/* =========================================================
   Lectura de datos: tablas pegadas desde Excel y listas de valores.
   Funciones puras (sin DOM), probadas en tests/parsing.test.js.
   ========================================================= */

import { parseNumber } from '../shared/format.js';

/** Número con punto decimal obligatorio (cuando la coma es delimitador). */
function parseDotNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { empty: true };
  if (s.includes(',')) return { error: true };
  return parseNumber(s);
}

const DELIMITERS = {
  tab: { label: 'tabulación', split: (l) => l.split('\t') },
  semicolon: { label: 'punto y coma', split: (l) => l.split(';') },
  comma: { label: 'coma (requiere punto decimal)', split: (l) => l.split(',') },
  space: { label: 'espacios', split: (l) => l.trim().split(/\s+/) },
};

export function detectDelimiter(text) {
  if (text.includes('\t')) return 'tab';
  if (text.includes(';')) return 'semicolon';
  if (text.includes(',')) return 'comma';
  return 'space';
}

/**
 * Analiza texto pegado con dos columnas (x, y). No descarta nada en silencio:
 * cada línea vuelve con su estado y, si es inválida, el motivo.
 * Devuelve { delimiter, delimiterLabel, header, indexColumn, lines: [{ lineNo, raw, cells, x, y, ok, error }] }.
 */
export function parseTwoColumns(text) {
  const delimiter = detectDelimiter(text);
  const { split, label } = DELIMITERS[delimiter];
  const read = delimiter === 'comma' ? parseDotNumber : parseNumber;

  let lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((raw, k) => ({ lineNo: k + 1, raw }))
    .filter((l) => l.raw.trim() !== '')
    .map((l) => ({ ...l, cells: split(l.raw).map((c) => c.trim()) }));

  // Encabezado: primera línea sin ningún número
  let header = null;
  if (lines.length && lines[0].cells.every((c) => read(c).value === undefined)) {
    header = lines[0];
    lines = lines.slice(1);
  }

  // Columna de índice i (0,1,2… o 1,2,3…) antes de x e y
  let indexColumn = false;
  if (lines.length > 1 && lines.every((l) => l.cells.length === 3)) {
    const first = lines.map((l) => read(l.cells[0]).value);
    const start = first[0];
    if ((start === 0 || start === 1) && first.every((v, k) => v === start + k)) {
      indexColumn = true;
      lines = lines.map((l) => ({ ...l, cells: l.cells.slice(1) }));
    }
  }

  const parsed = lines.map((l) => {
    const out = { ...l, x: undefined, y: undefined, ok: false, error: '' };
    if (l.cells.length !== 2) {
      out.error = `Se esperaban 2 columnas y hay ${l.cells.length}`;
      return out;
    }
    const px = read(l.cells[0]);
    const py = read(l.cells[1]);
    const why = (p, name) => {
      if (p.empty) return `${name} vacío`;
      if (p.nonFinite) return `${name} fuera de rango`;
      if (p.error) return delimiter === 'comma' && l.cells.some((c) => /\d,\d/.test(c)) ? `${name} no válido` : `${name} no es un número válido`;
      return '';
    };
    out.error = [why(px, 'x'), why(py, 'y')].filter(Boolean).join('; ');
    out.x = px.value;
    out.y = py.value;
    out.ok = !out.error;
    return out;
  });

  return { delimiter, delimiterLabel: label, header, indexColumn, lines: parsed };
}

/**
 * Lista de valores para predecir/evaluar.
 * Preferidos: punto y coma o saltos de línea (admiten coma decimal).
 * Si no hay ninguno, la coma se toma como separador cuando hay varias comas,
 * comas seguidas de espacio o punto decimal; «1,5» solo se lee como 1.5.
 * Devuelve { values, errors: [{ token, message }], separator }.
 */
export function parseValueList(text) {
  const src = String(text ?? '').trim();
  if (!src) return { values: [], errors: [], separator: null };

  let tokens;
  let separator;
  let read = parseNumber;
  if (/[;\n]/.test(src)) {
    tokens = src.split(/[;\n]+/);
    separator = 'punto y coma / salto de línea';
  } else if ((src.match(/,/g) || []).length > 1 || /,\s/.test(src) || (src.includes(',') && src.includes('.'))) {
    tokens = src.split(',');
    separator = 'coma';
    read = (t) => (t.includes(',') ? { error: true } : parseNumber(t));
  } else if (/\s/.test(src)) {
    tokens = src.split(/\s+/);
    separator = 'espacio';
  } else {
    tokens = [src];
    separator = null;
  }

  const values = [];
  const errors = [];
  tokens.map((t) => t.trim()).forEach((t) => {
    if (!t) return errors.push({ token: '(vacío)', message: 'Hay un valor vacío entre separadores.' });
    const p = read(t);
    if (p.value === undefined) errors.push({ token: t, message: p.nonFinite ? 'Fuera de rango' : 'No es un número válido' });
    else values.push(p.value);
  });
  return { values, errors, separator };
}
