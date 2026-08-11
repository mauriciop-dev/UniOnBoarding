// chat.js — Chat conversacional reutilizando la cadena de providers de IA.
// Igual failover (Groq -> Gemini -> DeepSeek -> Bedrock) con retry/backoff,
// pero devuelve texto libre (respuesta a pregunta), no JSON de análisis.

import { GoogleGenerativeAI } from '@google/generative-ai';

const PROVIDER_TIMEOUT = 10000;
const TOTAL_BUDGET_MS = 18000;
const MAX_ATTEMPTS = 2;
const RETRY_RE = /429|5\d\d|timeout|abort|fetch failed|ECONN|network|quota/i;

const CHAT_SYSTEM_PROMPT = `Eres el tutor conversacional de ProOnboarding, una extension que ayuda a entender y usar cualquier sitio web.

Reglas:
- Responde en el idioma que use el usuario.
- Se claro, directo y sin rodeos. Usa viñetas cuando agreguen claridad.
- Si el usuario pregunta como lograr una accion en la pagina, da pasos concretos basados en el contexto provisto.
- Si la informacion no alcanza, dilo y sugiere pulsa "Esta pagina" para analizarla.`;

function buildSystem(lang) {
  const langHint = lang && lang !== 'es'
    ? `\nIDIOMA DE RESPUESTA: responde siempre en "${lang}".`
    : '';
  return `${CHAT_SYSTEM_PROMPT}${langHint}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isRetryable(err) {
  return err && typeof err.message === 'string' && RETRY_RE.test(err.message);
}

async function callWithRetry(fn, prompt, system, deadline) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) {
      lastErr = lastErr || new Error('Presupuesto de tiempo total agotado');
      break;
    }
    const timeoutMs = Math.min(PROVIDER_TIMEOUT, remaining);
    try {
      return await fn(prompt, system, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt >= MAX_ATTEMPTS) break;
      const delay = Math.min(350 * attempt, 900);
      if (Date.now() + delay >= deadline) break;
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function chatGroq(prompt, system, timeoutMs) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no configurada');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.5,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq devolvió respuesta vacía');
    return content.trim();
  } finally {
    clearTimeout(tid);
  }
}

async function chatDeepSeek(prompt, system, timeoutMs) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.5,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`DeepSeek ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek devolvió respuesta vacía');
    return content.trim();
  } finally {
    clearTimeout(tid);
  }
}

async function chatGemini(prompt, system, timeoutMs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: system,
    generationConfig: { temperature: 0.5, maxOutputTokens: 1024 }
  });
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await model.generateContent(prompt, { signal: controller.signal });
    return (result.response.text() || '').trim();
  } finally {
    clearTimeout(tid);
  }
}

async function chatBedrock(prompt, system, timeoutMs) {
  const apiKey = process.env.AWS_BEDROCK_API_KEY;
  if (!apiKey) throw new Error('AWS_BEDROCK_API_KEY no configurada');
  const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
  const model = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 1024, temperature: 0.5 }
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Bedrock ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.output?.message?.content;
    const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
    if (!text) throw new Error('Bedrock devolvió respuesta vacía');
    return text.trim();
  } finally {
    clearTimeout(tid);
  }
}

const PROVIDERS = [
  { name: 'groq', fn: chatGroq, hasKey: () => !!process.env.GROQ_API_KEY },
  { name: 'gemini', fn: chatGemini, hasKey: () => !!process.env.GEMINI_API_KEY },
  { name: 'deepseek', fn: chatDeepSeek, hasKey: () => !!process.env.DEEPSEEK_API_KEY },
  { name: 'bedrock', fn: chatBedrock, hasKey: () => !!process.env.AWS_BEDROCK_API_KEY }
];

export async function chatWithFallback(prompt, lang = 'es') {
  const attempts = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const system = buildSystem(lang);

  for (const provider of PROVIDERS) {
    if (!provider.hasKey()) {
      attempts.push({ provider: provider.name, skipped: 'no_key' });
      continue;
    }
    try {
      const t0 = Date.now();
      const text = await callWithRetry(provider.fn, prompt, system, deadline);
      return { text, provider: provider.name, elapsed_ms: Date.now() - t0, attempts };
    } catch (err) {
      attempts.push({ provider: provider.name, error: err.message });
      console.warn(`[chat] ${provider.name} failed:`, err.message);
    }
  }

  throw Object.assign(
    new Error('Todos los proveedores de IA fallaron'),
    { attempts }
  );
}