/* Ejemplos opcionales: solo se cargan al pulsar «Cargar ejemplo».
   Los algoritmos no dependen de estos datos ni de sus resultados. */

export const REGRESSION_EXAMPLE = {
  points: [
    { x: '0', y: '2.1' },
    { x: '1', y: '7.7' },
    { x: '2', y: '13.6' },
    { x: '3', y: '27.2' },
    { x: '4', y: '40.9' },
    { x: '5', y: '61.1' },
  ],
  degree: 2,
  predict: '7',
};

export const LAGRANGE_EXAMPLE = {
  points: [
    { x: '2.0', y: '0.5103757' },
    { x: '2.2', y: '0.5207843' },
    { x: '2.4', y: '0.5104147' },
    { x: '2.6', y: '0.4813306' },
    { x: '2.8', y: '0.4359160' },
  ],
  target: '2.5',
  degrees: [1, 2, 3],
};
