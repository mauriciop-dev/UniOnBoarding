import crypto from 'node:crypto';
import { analyzeWithFallback } from '../lib/ai-provider.js';
import { getCachedAnalysis, storeAnalysis } from '../lib/insforge-client.js';

const MAX_HTML_LENGTH = 30000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  try {
    const { url, html_cleaned, lang = 'es', dom_hash } = req.body || {};

    if (!html_cleaned || typeof html_cleaned !== 'string') {
      return res.status(400).json({ error: 'html_cleaned es requerido (string).' });
    }

    if (html_cleaned.length > MAX_HTML_LENGTH) {
      return res.status(400).json({
        error: `HTML demasiado grande (${html_cleaned.length} chars). Máximo ${MAX_HTML_LENGTH}.`
      });
    }

    const finalHash = dom_hash || crypto.createHash('sha256').update(html_cleaned).digest('hex');

    const cached = await getCachedAnalysis(finalHash, lang);
    if (cached) {
      return res.status(200).json({
        ...cached,
        _meta: { cached: true, dom_hash: finalHash, provider: 'cache' }
      });
    }

    const { result, provider, elapsed_ms, attempts } = await analyzeWithFallback(html_cleaned, lang);

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
