// ai-engine.js — Motor de IA (solo cloud API, sin Gemini Nano)

export async function analyzePageWithFallback({ url, html, lang, dom_hash, apiUrl, onStatus }) {
  onStatus?.('cloud_loading');

  const CLOUD_TIMEOUT = 25000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), CLOUD_TIMEOUT);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, html_cleaned: html, lang, dom_hash }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = data.detail || data.error || `HTTP ${res.status}`;
      throw new Error(detail);
    }

    data._meta = { ...(data._meta || {}), engine: 'cloud' };

    return {
      data,
      meta: { engine: 'cloud', cached: data._meta?.cached ?? false },
    };
  } finally {
    clearTimeout(id);
  }
}
