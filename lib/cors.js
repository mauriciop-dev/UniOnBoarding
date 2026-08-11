// CORS para la API de ProOnboarding.
// Solo permitimos origenes de la extension Chrome, localhost de desarrollo
// y dominios vercel.app (previews). Sin Origin (curl, scripts) -> '*'.

const EXT_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}|^chrome-extension:\/\/[a-z]/i;
const LOCAL_RE = /^https?:\/\/localhost(:\d+)?$/i;
const VERCEL_APP_RE = /\.vercel\.app$/i;

export function applyCors(req, res) {
  const origin = req.headers?.origin;
  let allowOrigin = '*';
  if (origin && (EXT_ORIGIN_RE.test(origin) || LOCAL_RE.test(origin) || VERCEL_APP_RE.test(origin))) {
    allowOrigin = origin;
  }
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export function isPreflight(req) {
  return req.method === 'OPTIONS';
}