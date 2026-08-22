import { applyCors, isPreflight } from '../lib/cors.js';
import { chatWithGemini } from '../lib/chat.js';
import { rejectWhenLimited } from '../lib/rate-limit.js';

const MAX_HISTORY = 8;
const MAX_CONTEXT = 12000;
const MAX_MESSAGE = 2000;

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req)) return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido. Usa POST.' });
  }
  if (rejectWhenLimited(req, res, 'chat', 30)) return;

  try {
    const { message, lang = 'es', pageContext, pageUrl, history } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message es requerido (string).' });
    }
    if (message.length > MAX_MESSAGE) {
      return res.status(400).json({ error: `message demasiado largo (${message.length} chars). Máximo ${MAX_MESSAGE}.` });
    }

    const parts = [];
    if (typeof pageUrl === 'string' && pageUrl) parts.push(`PAGINA ACTUAL: ${pageUrl}`);
    if (typeof pageContext === 'string' && pageContext) {
      parts.push(`CONTEXTO DE LA PAGINA:\n${pageContext.slice(0, MAX_CONTEXT)}`);
    }
    if (Array.isArray(history) && history.length) {
      const recent = history.slice(-MAX_HISTORY);
      const formatted = recent.map(m => {
        const role = m.role === 'user' ? 'USUARIO' : 'ASISTENTE';
        return `${role}: ${String(m.content || '').slice(0, 2000)}`;
      }).join('\n');
      if (formatted) parts.push(`HISTORIAL RECIENTE:\n${formatted}`);
    }
    parts.push(`USUARIO: ${message}`);

    const t0 = Date.now();
    const text = await chatWithGemini(parts.join('\n\n'), lang);
    const provider = 'gemini';
    const elapsed_ms = Date.now() - t0;
    const attempts = [];

    return res.status(200).json({ reply: text, provider, elapsed_ms, attempts });
  } catch (err) {
    return res.status(500).json({ error: 'Error procesando el chat.', detail: err.message, attempts: err.attempts });
  }
}
