// CORS para la API de ProOnboarding.
// Solo permitimos origenes de la extension Chrome, localhost de desarrollo
// y dominios vercel.app (previews). Sin Origin (curl, scripts) -> '*'.

const EXTENSION_ID = 'bjmcdmcaapheeocfkkeaiedbcndogelh';
const EXT_ORIGIN_RE = new RegExp(`^chrome-extension://${EXTENSION_ID}$`, 'i');
const LOCAL_RE = /^https?:\/\/localhost(:\d+)?$/i;
const VERCEL_APP_RE = /^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i;

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
