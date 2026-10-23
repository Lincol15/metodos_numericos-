/* Datos del proyecto: se muestran en la cabecera, el pie y los informes impresos. */

export const GROUP = 'Nexora';
export const COURSE = 'Métodos Numéricos';
export const TEACHER = 'Jessica Perez Rivera';
export const TEAM = [
  'Lincol Werner Yujra Calla',
  'Ronald Condori Olazabal',
  'Guido Daniel Mayta Suaña',
  'Antony Condori Valeriano',
  'Jhonatan Aguilar Paja',
];

/** Iniciales: primer nombre y primer apellido (los nombres tienen 1 o 2 palabras antes de los dos apellidos). */
export function initials(name) {
  const w = name.split(/\s+/);
  const surname = w[w.length - 2];
  return (w[0][0] + surname[0]).toUpperCase();
}
