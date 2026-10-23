import './style.css';
import './newton/newton-ui.js';
import './jacobi/jacobi-ui.js';
import './regression/regression-ui.js';
import './lagrange/lagrange-ui.js';

/* =========================================================
   Pestañas de métodos. Cada panel solo se oculta, así que
   conserva sus entradas y resultados al cambiar de pestaña.
   ========================================================= */

const METHODS = {
  newton: { title: 'Newton Interpolante', subtitle: 'Resuelve y comprende paso a paso' },
  jacobi: { title: 'Método de Jacobi', subtitle: 'Resuelve sistemas de ecuaciones paso a paso' },
  regression: { title: 'Regresión polinomial', subtitle: 'Ajuste por mínimos cuadrados, paso a paso' },
  lagrange: { title: 'Lagrange interpolante', subtitle: 'Interpolación polinomial con nodos seleccionados, paso a paso' },
};

const tabs = [...document.querySelectorAll('[role="tab"][data-method]')];

function activate(method, { focus = false } = {}) {
  if (!METHODS[method]) method = 'newton';
  tabs.forEach((tab) => {
    const on = tab.dataset.method === method;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) tab.focus();
  });
  const { title, subtitle } = METHODS[method];
  document.getElementById('app-title').textContent = title;
  document.getElementById('app-subtitle').textContent = subtitle;
  document.title = `${title} · Laboratorio Numérico`;
  history.replaceState(null, '', `#${method}`);
}

tabs.forEach((tab, idx) => {
  tab.addEventListener('click', () => activate(tab.dataset.method));
  tab.addEventListener('keydown', (e) => {
    const moves = { ArrowRight: idx + 1, ArrowLeft: idx - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = tabs[(moves[e.key] + tabs.length) % tabs.length];
    activate(next.dataset.method, { focus: true });
  });
});

activate(location.hash.slice(1));
