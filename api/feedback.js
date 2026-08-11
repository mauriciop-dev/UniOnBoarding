import { applyCors, isPreflight } from '../lib/cors.js';
import { storeFeedback } from '../lib/insforge-client.js';

const MAX_COMMENT = 1000;

function parseBody(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Cuerpo invalido');
  const rating = Number(raw.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('rating debe ser un entero entre 1 y 5');
  }
  return {
    rating,
    comment: String(raw.comment || '').slice(0, MAX_COMMENT),
    url: String(raw.url || '').slice(0, 2000),
    platform: String(raw.platform || '').slice(0, 200),
    provider: String(raw.provider || '').slice(0, 100),
    lang: String(raw.lang || 'es').slice(0, 10)
  };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req)) return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseBody(req.body);
    const result = await storeFeedback(body);
    res.status(200).json({ ok: true, stored: result.stored });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
