import crypto from 'node:crypto';
import { resolveIntent } from '../lib/ai-provider.js';
import { getCachedAnalysis, storeAnalysis } from '../lib/insforge-client.js';
import { applyCors, isPreflight } from '../lib/cors.js';
import { rejectWhenLimited } from '../lib/rate-limit.js';

const MAX_HTML_LENGTH = 30000;

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req)) {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }
  if (rejectWhenLimited(req, res, 'analyze-page', 12)) return;

  try {
    const { url, html_cleaned, lang = 'es', intent = '', previous_action = '' } = req.body || {};

    if (!html_cleaned || typeof html_cleaned !== 'string') {
      return res.status(400).json({ error: 'html_cleaned es requerido (string).' });
    }

    if (html_cleaned.length > MAX_HTML_LENGTH) {
      return res.status(400).json({
        error: `HTML demasiado grande (${html_cleaned.length} chars). Máximo ${MAX_HTML_LENGTH}.`
      });
    }

    const cacheInput = `${html_cleaned}\n\u0000${String(intent).slice(0, 500)}\n\u0000${String(previous_action).slice(0, 500)}`;
    const finalHash = crypto.createHash('sha256').update(cacheInput).digest('hex');

    const cached = await getCachedAnalysis(finalHash, lang);
    if (cached) {
      return res.status(200).json({
        ...cached,
        _meta: { cached: true, dom_hash: finalHash, provider: 'cache' }
      });
    }

    const t0 = Date.now();
    const result = await resolveIntent({ html: html_cleaned, intent, lang, previousAction: previous_action });
    const provider = 'gemini';
    const elapsed_ms = Date.now() - t0;
    const attempts = [];

    storeAnalysis({
      url: url || 'unknown',
      domHash: finalHash,
      lang,
      responseJson: result
    }).catch(err => console.warn('[cache] storeAnalysis falló:', err.message));

    return res.status(200).json({
      ...result,
      _meta: {
        cached: false,
        dom_hash: finalHash,
        provider,
        elapsed_ms,
        attempts
      }
    });
  } catch (err) {
    console.error('[analyze-page] error:', err);
    return res.status(500).json({
      error: 'Error procesando el análisis.',
      detail: err.message,
      attempts: err.attempts
    });
  }
}
