// dom-cleaner.js
// Devuelve un HTML simplificado del DOM actual que sirve como entrada para el LLM.
// Reglas: quitar scripts, estilos, comentarios, elementos ocultos, SVG y atributos ruidosos.
// Conservar estructura (nav, main, section, header, footer, article, aside),
// headings, parrafos, listas, formularios, botones, enlaces e inputs con su label asociado.

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
  if (!el) return false;
  if (el.nodeType !== 1) return false;
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
  if (node.nodeType === 3) {
    const t = truncateText(node.nodeValue || '');
    return t;
  }
  if (node.nodeType !== 1) return '';

  const tag = node.tagName;
  if (SKIP_TAGS.has(tag)) return '';
  if (isHidden(node)) return '';

  const children = Array.from(node.childNodes).map(c => walk(c, depth + 1)).join('');
  const attrs = cleanAttrs(node);
  const selfClosing = ['INPUT', 'IMG', 'BR', 'HR'].includes(tag);
  if (selfClosing) {
    return `<${tag.toLowerCase()}${attrs} />`;
  }
  return `<${tag.toLowerCase()}${attrs}>${children}</${tag.toLowerCase()}>`;
}

export function cleanDOM(root = document.body) {
  if (!root) return '';
  return walk(root, 0);
}

export function computeDomHash(html) {
  // Hash simple, no crypto en content script.
  let h = 5381;
  for (let i = 0; i < html.length; i++) {
    h = ((h << 5) + h + html.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
