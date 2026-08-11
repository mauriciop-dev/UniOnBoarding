// AI provider chain with automatic fallback.
// Tries providers in order: Groq -> Gemini -> DeepSeek.
// Each provider must return parsed JSON matching the schema validated below.

import { SYSTEM_PROMPT, buildUserPrompt } from './prompt-template.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const PROVIDER_TIMEOUT = 9000;
const TOTAL_BUDGET_MS = 25000;
const MAX_ATTEMPTS_PER_PROVIDER = 2;
const RETRY_BASE_DELAY_MS = 350;
const VALID_ACTIONS = new Set(['highlight', 'wait_for_click', 'input_required']);
const RETRYABLE_RE = /429|5\d\d|timeout|abort|fetch failed|ECONN|network|quota/i;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err) {
  return err && typeof err.message === 'string' && RETRYABLE_RE.test(err.message);
}

async function callWithRetry(fn, htmlCleaned, lang, deadline) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) {
      lastErr = lastErr || new Error('Presupuesto de tiempo total agotado');
      break;
    }
    const timeoutMs = Math.min(PROVIDER_TIMEOUT, remaining);
    try {
      return await fn(htmlCleaned, lang, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt >= MAX_ATTEMPTS_PER_PROVIDER) break;
      const delay = Math.min(RETRY_BASE_DELAY_MS * attempt, 900);
      console.warn(`[ai-provider] retry ${attempt}/${MAX_ATTEMPTS_PER_PROVIDER - 1} en ${delay}ms: ${err.message}`);
      if (Date.now() + delay >= deadline) break;
      await sleep(delay);
    }
  }
  throw lastErr;
}

function validateShape(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Respuesta vacía');
  if (!obj.page_analysis) throw new Error('Falta page_analysis');
  if (!obj.page_analysis.detected_platform_name) throw new Error('Falta detected_platform_name');
  if (!obj.page_analysis.general_purpose_summary) throw new Error('Falta general_purpose_summary');
  if (!obj.page_analysis.audio_welcome_script) throw new Error('Falta audio_welcome_script');
  if (!Array.isArray(obj.interactive_tour)) throw new Error('interactive_tour debe ser array');

  obj.interactive_tour.forEach((step, i) => {
    if (!step.element_selector) throw new Error(`Step ${i} sin element_selector`);
    if (!step.title) throw new Error(`Step ${i} sin title`);
    if (!step.audio_script) throw new Error(`Step ${i} sin audio_script`);
    if (!VALID_ACTIONS.has(step.action_type)) step.action_type = 'highlight';
    if (!step.step_number) step.step_number = i + 1;
  });
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No se encontró JSON válido en la respuesta');
    return JSON.parse(match[0]);
  }
}

async function callGemini(htmlCleaned, lang, timeoutMs = PROVIDER_TIMEOUT) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
      maxOutputTokens: 4096
    }
  });

  const t0 = Date.now();
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await model.generateContent(buildUserPrompt(htmlCleaned, lang), { signal: controller.signal });
    return extractJson(result.response.text());
  } finally {
    clearTimeout(tid);
  }
}

async function callGroq(htmlCleaned, lang, timeoutMs = PROVIDER_TIMEOUT) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no configurada');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(htmlCleaned, lang) }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq devolvió respuesta vacía');
    return extractJson(content);
  } finally {
    clearTimeout(tid);
  }
}

async function callDeepSeek(htmlCleaned, lang, timeoutMs = PROVIDER_TIMEOUT) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(htmlCleaned, lang) }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek devolvió respuesta vacía');
    return extractJson(content);
  } finally {
    clearTimeout(tid);
  }
}

async function callBedrockNova(htmlCleaned, lang, timeoutMs = PROVIDER_TIMEOUT) {
  const apiKey = process.env.AWS_BEDROCK_API_KEY;
  if (!apiKey) throw new Error('AWS_BEDROCK_API_KEY no configurada');

  const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
  const model = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: buildUserPrompt(htmlCleaned, lang) }] }],
        inferenceConfig: { maxTokens: 4096, temperature: 0.4, topP: 0.9 }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Bedrock ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.output?.message?.content;
    const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
    if (!text) throw new Error('Bedrock devolvió respuesta vacía');
    return extractJson(text);
  } finally {
    clearTimeout(tid);
  }
}

const PROVIDERS = [
  { name: 'groq',     fn: callGroq,     hasKey: () => !!process.env.GROQ_API_KEY },
  { name: 'gemini',   fn: callGemini,   hasKey: () => !!process.env.GEMINI_API_KEY },
  { name: 'deepseek', fn: callDeepSeek, hasKey: () => !!process.env.DEEPSEEK_API_KEY },
  { name: 'bedrock',  fn: callBedrockNova, hasKey: () => !!process.env.AWS_BEDROCK_API_KEY }
];

export async function analyzeWithFallback(htmlCleaned, lang = 'es') {
  const attempts = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const provider of PROVIDERS) {
    if (!provider.hasKey()) {
      attempts.push({ provider: provider.name, skipped: 'no_key' });
      continue;
    }
    try {
      const t0 = Date.now();
      const parsed = await callWithRetry(provider.fn, htmlCleaned, lang, deadline);
      validateShape(parsed);
      return {
        result: parsed,
        provider: provider.name,
        elapsed_ms: Date.now() - t0,
        attempts
      };
    } catch (err) {
      attempts.push({ provider: provider.name, error: err.message });
      console.warn(`[ai-provider] ${provider.name} failed:`, err.message);
    }
  }

  throw Object.assign(
    new Error('Todos los proveedores de IA fallaron'),
    { attempts }
  );
}

const PROVIDER_HEALTH_URLS = {
  groq: { method: 'GET', url: 'https://api.groq.com/openai/v1/models', authHeader: 'Authorization', authPrefix: 'Bearer ' },
  gemini: { method: 'GET', url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, authHeader: null },
  deepseek: { method: 'GET', url: 'https://api.deepseek.com/v1/models', authHeader: 'Authorization', authPrefix: 'Bearer ' },
};

async function reachBedrock() {
  const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
  const model = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.AWS_BEDROCK_API_KEY}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
        inferenceConfig: { maxTokens: 1 }
      })
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(tid);
  }
}

export async function listProvidersStatus() {
  const results = [];
  for (const p of PROVIDERS) {
    const configured = p.hasKey();
    let reachable = false;
    if (configured) {
      if (p.name === 'bedrock') {
        reachable = await reachBedrock();
      } else {
        const hc = PROVIDER_HEALTH_URLS[p.name];
        if (hc) {
          try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 5000);
            const url = typeof hc.url === 'function' ? hc.url(process.env[`${p.name.toUpperCase()}_API_KEY`]) : hc.url;
            const headers = {};
            if (hc.authHeader) headers[hc.authHeader] = `${hc.authPrefix}${process.env[`${p.name.toUpperCase()}_API_KEY`]}`;
            const res = await fetch(url, { method: hc.method, headers, signal: controller.signal });
            clearTimeout(tid);
            reachable = res.ok;
          } catch {
            reachable = false;
          }
        }
      }
    }
    results.push({ name: p.name, configured, reachable });
  }
  return results;
}
