// api/voice-token.js — Emite tokens efimeros para el Modo Voz.
// Las keys reales viven SOLO en el servidor (env). La extension usa el token
// de corta vida para conectar directo al WebSocket de Google/Deepgram sin
// exponer las keys ni pedir configuracion al usuario final.
//
//   provider: 'gemini_live'  -> POST /v1beta/auth_tokens (x-goog-api-key)
//   provider: 'deepgram_agent' -> POST /v1/auth/grant (Token)

import { applyCors, isPreflight } from '../lib/cors.js';
import { rejectWhenLimited } from '../lib/rate-limit.js';

const GEMINI_TOKEN_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';

async function postJson(url, { headers = {}, body, timeoutMs = 15000 }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.err_msg || data?.description || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function mintGeminiToken({ geminiKey, model }) {
  const now = new Date();
  const expire = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const sessionExpire = new Date(now.getTime() + 60 * 1000).toISOString();
  // El endpoint REST no acepta liveConnectConstraints (el SDK lo mapea aparte):
  // solo uses + expiraciones. El token se limita al Live API (v1beta/v1alpha).
  void model;
  const data = await postJson(GEMINI_TOKEN_URL, {
    headers: { 'x-goog-api-key': geminiKey },
    body: { uses: 1, expireTime: expire, newSessionExpireTime: sessionExpire }
  });
  if (!data?.name) {
    const err = new Error('Google no devolvio un token efimero.');
    err.status = 502;
    throw err;
  }
  return { provider: 'gemini_live', token: data.name, model, expiresAt: expire };
}

async function mintDeepgramToken({ deepgramKey }) {
  let data;
  try {
    data = await postJson(DEEPGRAM_GRANT_URL, {
      headers: { Authorization: `Token ${deepgramKey}` },
      body: { ttl: 60 }
    });
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      const e = new Error(`Deepgram rechazó el token efímero (${err.status}): tu clave no tiene permiso para /v1/auth/grant.`);
      e.status = 502;
      throw e;
    }
    throw err;
  }
  if (!data?.access_token) {
    const err = new Error('Deepgram no devolvio un access token.');
    err.status = 502;
    throw err;
  }
  return { provider: 'deepgram_agent', token: data.access_token, expiresIn: 60 };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req)) return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido. Usa POST.' });
  }
  if (rejectWhenLimited(req, res, 'voice-token', 10)) return;

  try {
    const { provider = 'gemini_live', model = DEFAULT_LIVE_MODEL } = req.body || {};

    if (provider === 'deepgram_agent') {
      const deepgramKey = process.env.DEEPGRAM_API_KEY;
      if (!deepgramKey) return res.status(500).json({ error: 'Falta DEEPGRAM_API_KEY en el servidor.' });
      const token = await mintDeepgramToken({ deepgramKey });
      return res.status(200).json(token);
    }

    if (provider === 'gemini_live') {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) return res.status(500).json({ error: 'Falta GEMINI_API_KEY en el servidor.' });
      const token = await mintGeminiToken({ geminiKey, model });
      return res.status(200).json(token);
    }

    return res.status(400).json({ error: `Provider no soportado: ${provider}` });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
}
