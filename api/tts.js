import { applyCors, isPreflight } from '../lib/cors.js';
import { synthesize } from '../lib/tts-engines.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req)) return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido. Usa POST.' });
  }

  try {
    const { text, lang = 'es', engine } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text es requerido (string).' });
    }

    const { buffer, contentType } = await synthesize({ text, lang, engine });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).end(buffer);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
}