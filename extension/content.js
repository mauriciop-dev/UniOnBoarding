(function () {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TITLE', 'HEAD',
    'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'VIDEO', 'AUDIO', 'SOURCE',
    'SVG', 'PATH', 'CIRCLE', 'RECT', 'POLYGON', 'POLYLINE', 'LINE', 'TEXT', 'G', 'DEFS', 'USE'
  ]);
  const KEEP_ATTRS = new Set([
    'id', 'class', 'name', 'href', 'type', 'placeholder', 'value', 'role', 'aria-label', 'title', 'alt', 'for', 'src'
  ]);
  const MAX_DEPTH = 25;
  const MAX_TEXT = 220;

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  }

  function cleanAttrs(el) {
    const out = [];
    for (const attr of el.attributes) {
      if (!KEEP_ATTRS.has(attr.name)) continue;
      if (attr.name === 'class' && attr.value.length > 120) continue;
      if ((attr.name === 'value' || attr.name === 'placeholder') && attr.value.length > 80) continue;
      out.push(`${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`);
    }
    return out.length ? ' ' + out.join(' ') : '';
  }

  function truncateText(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= MAX_TEXT) return t;
    return t.slice(0, MAX_TEXT) + '...';
  }

  function walk(node, depth) {
    if (depth > MAX_DEPTH) return '';
    if (node.nodeType === 8) return '';
    if (node.nodeType === 3) return truncateText(node.nodeValue || '');
    if (node.nodeType !== 1) return '';

    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return '';
    if (isHidden(node)) return '';

    const children = Array.from(node.childNodes).map(c => walk(c, depth + 1)).join('');
    const attrs = cleanAttrs(node);
    const selfClosing = ['INPUT', 'IMG', 'BR', 'HR'].includes(tag);
    if (selfClosing) return `<${tag.toLowerCase()}${attrs} />`;
    return `<${tag.toLowerCase()}${attrs}>${children}</${tag.toLowerCase()}>`;
  }

  function cleanDOM(root) {
    if (!root) return '';
    return walk(root, 0);
  }

  function computeDomHash(html) {
    let h = 5381;
    for (let i = 0; i < html.length; i++) {
      h = ((h << 5) + h + html.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
  }

  let currentHighlighted = null;
  let pendingResolve = null;

  function findElement(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); }
    catch (e) {
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
      return Promise.resolve({ ok: false, selector });
    }
    el.classList.add('proob-highlight');
    currentHighlighted = el;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (action_type === 'wait_for_click') {
      return new Promise(resolve => {
        const handler = (ev) => {
          if (!currentHighlighted || !currentHighlighted.contains(ev.target)) return;
          cleanup();
          resolve({ ok: true, completed: true });
        };
        const cleanup = () => {
          if (currentHighlighted) currentHighlighted.removeEventListener('click', handler, true);
          document.removeEventListener('click', handler, true);
          pendingResolve = null;
        };
        document.addEventListener('click', handler, true);
        pendingResolve = resolve;
      });
    }

    if (action_type === 'input_required') {
      return new Promise(resolve => {
        const handler = () => {
          if (el.value && el.value.trim().length > 0) {
            cleanup();
            resolve({ ok: true, completed: true, value: el.value });
          }
        };
        const cleanup = () => {
          el.removeEventListener('input', handler);
          pendingResolve = null;
        };
        el.addEventListener('input', handler);
        pendingResolve = resolve;
      });
    }

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
      sendResponse({ ok: true });
      return true;
    }
  });
})();
