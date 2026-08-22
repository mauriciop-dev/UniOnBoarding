// Limitador defensivo por instancia. No sustituye un rate limiter distribuido,
// pero reduce ráfagas y abuso accidental sin agregar infraestructura externa.
const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_ENTRIES = 5_000;

function clientKey(req, scope) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = String(forwarded || req.headers?.['x-real-ip'] || 'unknown')
    .split(',')[0].trim().slice(0, 100);
  return `${scope}:${ip}`;
}

export function rejectWhenLimited(req, res, scope, limit) {
  const now = Date.now();
  if (buckets.size > MAX_ENTRIES) {
    for (const [key, value] of buckets) {
      if (now - value.startedAt >= WINDOW_MS) buckets.delete(key);
    }
  }
  const key = clientKey(req, scope);
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  if (current.count <= limit) return false;
  const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' });
  return true;
}
