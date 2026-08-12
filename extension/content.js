(function () {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TITLE', 'HEAD',
    'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'VIDEO', 'AUDIO', 'SOURCE',
    'SVG', 'PATH', 'CIRCLE', 'RECT', 'POLYGON', 'POLYLINE', 'LINE', 'TEXT', 'G', 'DEFS', 'USE'
  ]);
  const KEEP_ATTRS = new Set([
    'id', 'class', 'name', 'href', 'type', 'placeholder', 'value', 'role', 'aria-label', 'title', 'alt', 'for', 'src'
  ]);

  function keepAttr(name) {
    return KEEP_ATTRS.has(name) || name.startsWith('data-');
  }
  const MAX_DEPTH = 25;
  const MAX_TEXT = 220;

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return true;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  }

  function cleanAttrs(el) {
    const out = [];
    for (const attr of el.attributes) {
      if (!keepAttr(attr.name)) continue;
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

  const AVATAR_ICONS = { bot: '🤖', man: '👨\u200D💻', woman: '👩\u200D💻' };
  const STEP_WAIT_MS = 25000;

  let currentHighlighted = null;
  let pendingResolve = null;
  let currentHandlers = [];
  let proobLayer = null;
  let waitTimer = null;
  let wrongClicks = 0;
  let overlayCleanup = null;

  function escapeClassTokens(str) {
    const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s;
    return String(str)
      .split(/(?=[.#])/)
      .map((seg) => seg.startsWith('.') ? '.' + esc(seg.slice(1)) : seg)
      .join('');
  }

  function findElement(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); }
    catch (e) {
      const repaired = escapeClassTokens(selector);
      try {
        const el = repaired !== selector ? document.querySelector(repaired) : null;
        if (el) return el;
      } catch { /* sin reparacion posible */ }
      console.warn('[ProOnboarding] selector invalido:', selector,
        repaired !== selector ? `-> reparado: ${repaired}` : e.message);
      return null;
    }
  }

  function clearHighlight() {
    if (currentHighlighted) {
      currentHighlighted.classList.remove('proob-highlight');
      currentHighlighted = null;
    }
    hideOverlay();
    cleanupHandlers();
  }

  function cleanupHandlers() {
    currentHandlers.forEach(({ el, type, handler }) => {
      el.removeEventListener(type, handler, true);
    });
    currentHandlers = [];
    pendingResolve = null;
  }

  function showToast(message) {
    const t = document.createElement('div');
    t.className = 'proob-toast';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function ensureLayer() {
    if (proobLayer && proobLayer.isConnected) return proobLayer;
    proobLayer = document.createElement('div');
    proobLayer.className = 'proob-layer';
    proobLayer.style.display = 'none';
    document.body.appendChild(proobLayer);
    return proobLayer;
  }

  function setOverlayContent(html) {
    const layer = ensureLayer();
    layer.style.display = 'block';
    layer.innerHTML = html;
    return layer;
  }

  function positionOverlay(el) {
    const layer = ensureLayer();
    const rect = el.getBoundingClientRect();
    let top = rect.top - 74;
    if (top < 10) top = rect.bottom + 14;
    const left = Math.min(Math.max(rect.left + rect.width / 2, 96), Math.max(window.innerWidth - 96, 96));
    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
  }

  function bindOverlayReposition(el) {
    overlayCleanup?.();
    const onMove = () => { if (el.isConnected) positionOverlay(el); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    overlayCleanup = () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }

  function hideOverlay() {
    if (proobLayer) proobLayer.style.display = 'none';
    overlayCleanup?.();
    overlayCleanup = null;
  }

  function updateAvatarIcon(avatar) {
    const a = ensureLayer().querySelector('.proob-avatar');
    if (a) a.textContent = AVATAR_ICONS[avatar] || AVATAR_ICONS.bot;
  }

  function renderOverlay(el, opts) {
    const avatarIcon = AVATAR_ICONS[opts.avatar] || AVATAR_ICONS.bot;
    const parts = [`<div class="proob-label"><span class="proob-avatar">${avatarIcon}</span>`];
    if (opts.label) parts.push(`<span class="proob-label-title">${escapeHtml(opts.label)}</span>`);
    parts.push('</div>');
    if (opts.cta) parts.push(`<div class="proob-cta">${escapeHtml(opts.cta)}</div>`);
    if (opts.help) {
      parts.push('<div class="proob-help">');
      parts.push(`<div class="proob-help-text">${escapeHtml(opts.helpText || '¿Necesitas ayuda?')}</div>`);
      if (opts.onRetry) parts.push(`<button class="proob-help-btn retry">${escapeHtml(opts.helpRetryLabel || 'Repetir')}</button>`);
      if (opts.onContinue) parts.push(`<button class="proob-help-btn primary">${escapeHtml(opts.helpContinueLabel || 'Continuar')}</button>`);
      parts.push('</div>');
    }
    const layer = setOverlayContent(parts.join(''));
    positionOverlay(el);
    layer.querySelector('.proob-help-btn.retry')?.addEventListener('click', () => opts.onRetry());
    layer.querySelector('.proob-help-btn.primary')?.addEventListener('click', () => opts.onContinue());
  }

  function highlightStep({ selector, action_type, label, cta, avatar }) {
    clearHighlight();
    const el = findElement(selector);
    if (!el) {
      showToast(`No se encontro el elemento: ${selector}`);
      return Promise.resolve({ ok: false, selector });
    }
    el.classList.add('proob-highlight');
    currentHighlighted = el;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bindOverlayReposition(el);

    const stopTimer = () => { if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; } };

    if (action_type === 'wait_for_click') {
      return new Promise(resolve => {
        const showHelp = () => {
          wrongClicks = 0;
          renderOverlay(el, {
            label, cta: null, avatar,
            help: true,
            helpText: 'Parece que necesitas ayuda con este paso.',
            helpRetryLabel: 'Ver de nuevo',
            helpContinueLabel: 'Continuar',
            onRetry: () => arm(),
            onContinue: () => finish(false)
          });
        };
        const arm = () => {
          stopTimer();
          wrongClicks = 0;
          renderOverlay(el, { label, cta, avatar });
          waitTimer = setTimeout(showHelp, STEP_WAIT_MS);
        };
        const finish = (ok, extra) => {
          cleanupHandlers();
          hideOverlay();
          resolve({ ok, completed: ok, ...extra });
        };
        const handler = (ev) => {
          if (proobLayer?.contains(ev.target)) return;
          if (!currentHighlighted || !currentHighlighted.contains(ev.target)) {
            wrongClicks += 1;
            if (wrongClicks >= 2) showHelp();
            return;
          }
          finish(true);
        };
        document.addEventListener('click', handler, true);
        currentHandlers.push({ el: document, type: 'click', handler });
        pendingResolve = resolve;
        arm();
      });
    }

    if (action_type === 'input_required') {
      return new Promise(resolve => {
        const showHelp = () => {
          wrongClicks = 0;
          renderOverlay(el, {
            label, cta: null, avatar,
            help: true,
            helpText: 'Escribe algo en el campo resaltado para continuar.',
            helpRetryLabel: 'Volver a intentar',
            helpContinueLabel: 'Saltar',
            onRetry: () => arm(),
            onContinue: () => finish(false, { skipped: true })
          });
        };
        const arm = () => {
          stopTimer();
          wrongClicks = 0;
          renderOverlay(el, { label, cta, avatar });
          waitTimer = setTimeout(showHelp, STEP_WAIT_MS);
        };
        const finish = (ok, extra) => {
          cleanupHandlers();
          hideOverlay();
          resolve({ ok, completed: ok, ...extra });
        };
        const handler = () => {
          if (el.value && el.value.trim().length > 0) finish(true, { value: el.value });
        };
        el.addEventListener('input', handler);
        currentHandlers.push({ el, type: 'input', handler });
        pendingResolve = resolve;
        arm();
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

    if (msg?.type === 'PROOB_AVATAR') {
      updateAvatarIcon(msg.avatar);
      sendResponse({ ok: true });
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
