// tts-engines.js — Motores de TTS cloud para el endpoint /api/tts.
//
// L2 (nube): Deepgram por defecto (REST simple, gratis para desarrolladores).
//            Nova Sonic (AWS) requiere credenciales IAM SigV4 y el modelo
//            bidireccional; se habilita cuando se configuran.
//
// Cada motor devuelve { buffer, contentType } para ser servido como audio.

const MAX_TEXT = 2000;

const DEEPGRAM_MODELS = {
  es: 'aura-2-selena-es',
  en: 'aura-2-thalia-en',
  fr: 'aura-2-agathe-fr',
  it: 'aura-2-cesare-it',
  de: 'aura-2-elara-de',
  ja: 'aura-2-uzume-ja',
  nl: 'aura-2-beatrix-nl'
};

export function isTtsConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY) || isNovaConfigured();
}

function isNovaConfigured() {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );
}

export async function synthesize({ text, lang = 'es', engine }) {
  if (!text || text.length > MAX_TEXT) {
    const err = new Error('text vacio o demasiado largo');
    err.status = 400;
    throw err;
  }

  const engines = [];
  if (process.env.DEEPGRAM_API_KEY) engines.push('deepgram');
  if (isNovaConfigured()) engines.push('novasonic');
  if (!engines.length) {
    const err = new Error('TTS cloud no configurado. Fija DEEPGRAM_API_KEY o las credenciales IAM de AWS.');
    err.status = 503;
    throw err;
  }

  const chosen = engine && engines.includes(engine) ? engine : engines[0];
  if (chosen === 'deepgram') return synthDeepgram(text, lang);
  throw new Error('Nova Sonic no esta implementado aun; requiere stream bidireccional y credenciales IAM.');
}

async function synthDeepgram(text, lang) {
  const model = DEEPGRAM_MODELS[lang] || DEEPGRAM_MODELS.es;
  const url = `https://api.deepgram.com/v1/speak?model=${model}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`
    },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`Deepgram ${res.status}: ${errText.slice(0, 200)}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  return { buffer: Buffer.from(arrayBuffer), contentType };
}