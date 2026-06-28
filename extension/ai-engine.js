/**
 * ai-engine.js — Motor de IA con fallback
 *
 * Jerarquía de motores:
 *   1. Gemini Nano (LanguageModel API, Chrome built-in)
 *   2. API en la nube (Vercel / endpoint configurable)
 *
 * Interfaz pública:
 *   analyzePageWithFallback({ url, html, lang, dom_hash, apiUrl, onStatus })
 *   → Promise<{ data, meta: { engine, cached } }>
 *
 *   detectAvailableEngine()
 *   → Promise<'nano'|'cloud'>
 *
 *   getNanoAvailability()
 *   → Promise<'readily'|'after-download'|'unavailable'>
 */

// ---------------------------------------------------------------------------
// Utilidad: timeout para promesas
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, label) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(label ? `Tiempo de espera agotado: ${label} (${ms}ms)` : `Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

// ---------------------------------------------------------------------------
// Detección de disponibilidad de Gemini Nano
// ---------------------------------------------------------------------------

const NANO_TIMEOUT_READILY = 60000;
const NANO_TIMEOUT_DOWNLOAD = 120000;

/**
 * Retorna el estado crudo de disponibilidad de Gemini Nano.
 * @returns {Promise<'readily'|'after-download'|'unavailable'>}
 */
export async function getNanoAvailability() {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  try {
    const availability = await LanguageModel.availability();
    if (availability === 'readily') return 'readily';
    if (availability === 'after-download' || availability === 'available') return 'after-download';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Verifica si se puede usar Gemini Nano (sin obligar descarga).
 * @returns {Promise<boolean>}
 */
export async function isNanoAvailable() {
  const status = await getNanoAvailability();
  return status === 'readily' || status === 'after-download';
}

// ---------------------------------------------------------------------------
// Motor 1: Gemini Nano (local)
// ---------------------------------------------------------------------------

/**
 * Construye el prompt para Gemini Nano con el HTML de la página.
 */
function buildNanoPrompt(url, html, lang) {
  const langLabels = { es: 'español', en: 'English', pt: 'português', fr: 'français' };
  const langLabel = langLabels[lang] || 'español';

  return `Eres un asistente de onboarding web experto. Analiza el siguiente HTML de una página web y responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones ni markdown, sin bloques de código, solo el JSON crudo.

El JSON debe seguir exactamente esta estructura:
{
  "page_analysis": {
    "detected_platform_name": "nombre corto de la plataforma o app",
    "general_purpose_summary": "párrafo de 2-3 oraciones explicando qué hace esta página",
    "audio_welcome_script": "texto para leer en voz alta como bienvenida (máximo 80 palabras en ${langLabel})"
  },
  "interactive_tour": [
    {
      "step_number": 1,
      "title": "Título del paso",
      "text_explanation": "Explicación de qué hace este elemento y para qué sirve",
      "audio_script": "Texto corto para leer en voz alta en ${langLabel}",
      "element_selector": "selector CSS del elemento (ej: #login-btn, .search-input)",
      "action_type": "navigate"
    }
  ]
}

Reglas:
- Genera entre 3 y 7 pasos en interactive_tour, priorizando los elementos más importantes.
- Los selectores CSS deben apuntar a elementos reales presentes en el HTML dado.
- action_type puede ser: "navigate", "wait_for_click", o "input_required".
- Responde en ${langLabel}.
- Solo devuelve el JSON, nada más.

URL de la página: ${url}

HTML de la página (simplificado):
${html.slice(0, 5000)}`;
}

/**
 * Extrae el primer objeto JSON válido de un string de texto.
 */
function extractJsonFromText(text) {
  try {
    return JSON.parse(text.trim());
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  throw new Error('No se pudo parsear el JSON de la respuesta de Gemini Nano.');
}

/**
 * Valida que el objeto parseado tenga la estructura mínima esperada.
 */
function validateNanoResponse(obj) {
  if (!obj?.page_analysis?.general_purpose_summary) {
    throw new Error('La respuesta de Nano no tiene el formato esperado.');
  }
  if (!Array.isArray(obj.interactive_tour) || obj.interactive_tour.length === 0) {
    throw new Error('Nano no generó pasos de tour interactivo.');
  }
  return true;
}

/**
 * Ejecuta el análisis usando Gemini Nano.
 */
async function analyzeWithNano(url, html, lang, nanoStatus) {
  const timeout = nanoStatus === 'readily' ? NANO_TIMEOUT_READILY : NANO_TIMEOUT_DOWNLOAD;

  const session = await withTimeout(
    LanguageModel.create({ expectedOutputLanguages: [lang || 'es'] }),
    timeout,
    'LanguageModel.create()',
  );

  let rawResponse;
  try {
    const prompt = buildNanoPrompt(url, html, lang);
    rawResponse = await withTimeout(
      session.prompt(prompt),
      timeout,
      'session.prompt()',
    );
  } finally {
    session.destroy?.();
  }

  const parsed = extractJsonFromText(rawResponse);
  validateNanoResponse(parsed);

  parsed._meta = { engine: 'nano', cached: false };

  return parsed;
}

// ---------------------------------------------------------------------------
// Motor 2: API Cloud (Vercel)
// ---------------------------------------------------------------------------

/**
 * Ejecuta el análisis llamando al endpoint en la nube.
 */
async function analyzeWithCloud(url, html, lang, dom_hash, apiUrl) {
  const CLOUD_TIMEOUT = 25000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), CLOUD_TIMEOUT);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, html_cleaned: html, lang, dom_hash }),
    signal: controller.signal,
  }).finally(() => clearTimeout(id));

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = data.detail || data.error || `HTTP ${res.status}`;
    throw new Error(detail);
  }

  data._meta = { ...(data._meta || {}), engine: 'cloud' };

  return data;
}

// ---------------------------------------------------------------------------
// Interfaz pública
// ---------------------------------------------------------------------------

/**
 * Analiza una página web intentando primero con Gemini Nano.
 * Si Nano no está disponible o falla, usa el API en la nube.
 *
 * @param {object} params
 * @param {string} params.url       - URL de la página
 * @param {string} params.html      - HTML limpio extraído por content.js
 * @param {string} params.lang      - Código de idioma (es, en, pt, fr)
 * @param {string} params.dom_hash  - Hash del DOM para caché en cloud
 * @param {string} params.apiUrl    - URL del endpoint cloud (fallback)
 * @param {function} [params.onStatus] - Callback para actualizar estado en UI
 *
 * @returns {Promise<{ data: object, meta: { engine: string, cached: boolean } }>}
 */
export async function analyzePageWithFallback({ url, html, lang, dom_hash, apiUrl, onStatus }) {
  const status = await getNanoAvailability();
  const nanoReady = status === 'readily' || status === 'after-download';

  if (nanoReady) {
    onStatus?.('nano_loading');
    try {
      const data = await analyzeWithNano(url, html, lang, status);
      return {
        data,
        meta: { engine: 'nano', cached: false },
      };
    } catch (nanoError) {
      console.warn('[ProOnboarding] Gemini Nano falló, usando API cloud. Razón:', nanoError.message);
    }
  }

  onStatus?.('cloud_loading');
  const data = await analyzeWithCloud(url, html, lang, dom_hash, apiUrl);
  return {
    data,
    meta: { engine: 'cloud', cached: data._meta?.cached ?? false },
  };
}

/**
 * Detecta el motor disponible sin ejecutar análisis.
 * @returns {Promise<'nano'|'cloud'>}
 */
export async function detectAvailableEngine() {
  const available = await isNanoAvailable();
  return available ? 'nano' : 'cloud';
}
