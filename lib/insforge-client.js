// InsForge REST client (PostgREST-style via /api/database/records/{table})
// Auth: project API key (ik_...) or anon key via Authorization header.

let baseUrl = null;
let apiKey = null;

function init() {
  if (baseUrl) return;
  const url = process.env.INSFORGE_URL;
  const key = process.env.INSFORGE_API_KEY || process.env.INSFORGE_ANON_KEY;
  if (!url || !key) return;
  baseUrl = url.replace(/\/+$/, '');
  apiKey = key;
}

function isReady() {
  init();
  return Boolean(baseUrl && apiKey);
}

async function request(path, options = {}) {
  init();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey,
      'Authorization': `Bearer ${apiKey}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`InsForge ${res.status}: ${text || res.statusText}`);
  }
  return res;
}

function encodeEq(value) {
  return `eq.${encodeURIComponent(value)}`;
}

export async function getCachedAnalysis(domHash, lang) {
  if (!isReady()) return null;

  try {
    const res = await request(
      `/api/database/records/page_analyses?select=response_json,created_at&dom_hash=${encodeEq(domHash)}&lang=${encodeEq(lang)}&order=created_at.desc&limit=1`
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0].response_json;
  } catch (err) {
    console.warn('[InsForge] cache read error:', err.message);
    return null;
  }
}

export async function storeAnalysis({ url, domHash, lang, responseJson }) {
  if (!isReady()) return;

  try {
    await request('/api/database/records/page_analyses', {
      method: 'POST',
      headers: {
        'Prefer': 'resolution=merge-duplicates',
        'return': 'minimal'
      },
      body: JSON.stringify({
        url,
        dom_hash: domHash,
        lang,
        response_json: responseJson
      })
    });
  } catch (err) {
    console.warn('[InsForge] cache write error:', err.message);
  }
}

export async function healthCheck() {
  if (!isReady()) return { ok: false, reason: 'not_configured' };
  try {
    const res = await request('/api/database/tables');
    await res.json();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
