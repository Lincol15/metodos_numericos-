# Laboratorio Numérico

Web educativa que resuelve ejercicios de métodos numéricos y muestra todo el desarrollo paso a paso:

- **Interpolación de Newton** (diferencias divididas)
- **Método de Jacobi** (sistemas Ax = b)
- **Regresión polinomial** por mínimos cuadrados
- **Lagrange interpolante**

Hecha con Vite, JavaScript vanilla, HTML y CSS. Usa Chart.js (gráficas de regresión y Lagrange) y KaTeX (fórmulas), instalados con npm. No hay backend: todo se calcula en el navegador.

## Comandos

```bash
npm install        # instala dependencias
npm run dev        # servidor de desarrollo (http://localhost:5173)
npm run build      # versión de producción en dist/
npm run preview    # sirve la versión de producción
npm test           # pruebas matemáticas (node --test, sin dependencias extra)
```

## Estructura

```
index.html                  pestañas y paneles de los cuatro métodos
src/main.js                 cambio de pestaña (los paneles se ocultan, no se borran)
src/style.css               estilos (incluye la vista imprimible)

src/math/                   ALGORITMOS PUROS (sin DOM)
  matrices.js               Gauss-Jordan con pivoteo parcial, QR de Householder
  statistics.js             media, Pearson
  regression.js             sumatorias, ecuaciones normales, ajuste QR estable, R², s
  lagrange.js               selección de nodos, bases Li, forma baricéntrica
src/newton/newton-math.js   diferencias divididas
src/jacobi/jacobi-math.js   iteración de Jacobi, dominancia, permutación de filas

src/utils/parsing.js        lectura de datos pegados y listas de valores
src/utils/export.js         copiar texto, CSV, vista imprimible
src/shared/format.js        lectura estricta de números y formato
src/data/examples.js        ejemplos opcionales

src/ui/                     componentes de interfaz reutilizables
  tables.js                 editor i|xi|yi, importador con vista previa, tablas paginadas
  formulas.js               ayudas KaTeX (signos, matrices, fracciones)
  charts.js                 Chart.js: una instancia por gráfica, muestreo de curvas, zoom
src/regression/regression-ui.js   entradas, desarrollo y eventos de regresión
src/lagrange/lagrange-ui.js       entradas, desarrollo y eventos de Lagrange
src/newton/newton-ui.js, src/jacobi/jacobi-ui.js

tests/                      pruebas ejecutables (node:test)
```

## Algoritmos

**Regresión polinomial.** Se construyen las sumatorias S_k = Σx^k y T_k = Σx^k·y, las ecuaciones normales C·a = b y la inversa de C por Gauss-Jordan con pivoteo parcial (tolerancia de pivote n·ε·máx|C_ij|). Como las ecuaciones normales pueden perder precisión, el ajuste se resuelve además con QR de Householder sobre t = (x − c)/h (x centrado y escalado). Esa forma estable se usa para evaluar, predecir y graficar; sus coeficientes se convierten a la variable x para mostrarlos, y la app compara ambos procedimientos y avisa si discrepan.

**Lagrange.** Para cada grado g se eligen g + 1 nodos (los más cercanos al objetivo, con empates resueltos a favor del menor x, o una selección manual) y ese conjunto queda fijo para toda la curva. La forma clásica P = Σ yi·Li(x) se usa para la explicación y la forma baricéntrica para evaluar; ambas se comparan con tolerancia, junto con ΣLi ≈ 1 y la reproducción de los nodos.

**Jacobi.** Cada iteración lee solo el vector anterior y escribe en uno nuevo. Se detiene cuando el cambio ‖x⁽ᵏ⁾ − x⁽ᵏ⁻¹⁾‖∞ y el residuo ‖Ax − b‖∞ son ambos ≤ tolerancia.

**Newton.** Tabla triangular D[i][j] de diferencias divididas y polinomio en forma de Newton.

En todos los métodos los cálculos usan la precisión completa y solo se redondea al mostrar.

## Pruebas

`npm test` ejecuta `tests/*.test.js`:

- `regression.test.js`: recta y parábola exactas, ejemplo suministrado (a0, a1, a2, s, R², R, P(7)), n = m + 1, yi constantes, xi repetidos, xi distintos insuficientes, valores negativos y grandes, matriz singular y desbordamiento.
- `lagrange.test.js`: ejemplo (nodos elegidos y P1, P2, P3), funciones lineal y cuadrática, nodos no equidistantes, evaluación en un nodo, empates, extrapolación y curva con nodos fijos.
- `parsing.test.js`: delimitadores, coma decimal, encabezados, líneas inválidas y listas de predicciones.
- `newton-jacobi.test.js`: casos de referencia de los dos primeros métodos.
