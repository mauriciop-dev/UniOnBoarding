// Content script: se inyecta en cada pagina y queda a la escucha de mensajes del side panel.
// Responsabilidades:
//  1. Extraer un DOM limpio y enviarlo al side panel cuando se pida.
//  2. Resaltar / quitar resaltado de un selector CSS (paso del tour).
//  3. Detectar clic o input del usuario en el elemento resaltado cuando el paso lo requiere.

import { cleanDOM, computeDomHash } from './dom-cleaner.js';

let currentHighlighted = null;
let pendingAction = null; // 'wait_for_click' | 'input_required' | null
let pendingResolve = null;

function findElement(selector) {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch (e) {
    console.warn('[ProOnboarding] selector invalido:', selector, e.message);
    return null;
  }
}

function clearHighlight() {
  if (currentHighlighted) {
    currentHighlighted.classList.remove('proob-highlight');
    currentHighlighted = null;
  }
}

function showToast(message) {
  const t = document.createElement('div');
  t.className = 'proob-toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function highlightStep({ selector, action_type }) {
  clearHighlight();
  const el = findElement(selector);
  if (!el) {
    showToast(`No se encontro el elemento: ${selector}`);
    return { ok: false, selector };
  }
  el.classList.add('proob-highlight');
  currentHighlighted = el;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Si el paso requiere interaccion del usuario, nos preparamos.
  if (action_type === 'wait_for_click') {
    pendingAction = 'wait_for_click';
    return new Promise(resolve => {
      const handler = (ev) => {
        if (!currentHighlighted || !currentHighlighted.contains(ev.target)) return;
        cleanup();
        resolve({ ok: true, completed: true });
      };
      const cleanup = () => {
        currentHighlighted && currentHighlighted.removeEventListener('click', handler, true);
        document.removeEventListener('click', handler, true);
        pendingAction = null;
        pendingResolve = null;
      };
      // Captura para tomar el clic antes que handlers de la pagina.
      document.addEventListener('click', handler, true);
      pendingResolve = resolve;
    });
  }

  if (action_type === 'input_required') {
    pendingAction = 'input_required';
    return new Promise(resolve => {
      const handler = () => {
        if (el.value && el.value.trim().length > 0) {
          cleanup();
          resolve({ ok: true, completed: true, value: el.value });
        }
      };
      const cleanup = () => {
        el.removeEventListener('input', handler);
        pendingAction = null;
        pendingResolve = null;
      };
      el.addEventListener('input', handler);
      pendingResolve = resolve;
    });
  }

  // action_type === 'highlight' u otros: solo visual, no bloquea.
  return Promise.resolve({ ok: true, completed: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PROOB_EXTRACT') {
    try {
      const html = cleanDOM(document.body);
      const dom_hash = computeDomHash(html);
      sendResponse({ ok: true, html, dom_hash, url: location.href, title: document.title });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  if (msg?.type === 'PROOB_HIGHLIGHT') {
    highlightStep(msg.payload).then(result => sendResponse(result));
    return true;
  }

  if (msg?.type === 'PROOB_CLEAR_HIGHLIGHT') {
    clearHighlight();
    if (pendingResolve) {
      pendingResolve({ ok: false, completed: false, cancelled: true });
      pendingResolve = null;
    }
    pendingAction = null;
    sendResponse({ ok: true });
    return true;
  }
});
