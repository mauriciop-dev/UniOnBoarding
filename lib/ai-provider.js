// AI provider chain with automatic fallback.
// Tries providers in order: Gemini -> Groq -> DeepSeek.
// Each provider must return parsed JSON matching the schema validated below.

import { SYSTEM_PROMPT, buildUserPrompt } from './prompt-template.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const VALID_ACTIONS = new Set(['highlight', 'wait_for_click', 'input_required']);

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

async function callGemini(htmlCleaned, lang) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
      maxOutputTokens: 8192
    }
  });

  const result = await model.generateContent(buildUserPrompt(htmlCleaned, lang));
  return extractJson(result.response.text());
}

async function callGroq(htmlCleaned, lang) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no configurada');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.4,
      max_tokens: 8192,
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
}

async function callDeepSeek(htmlCleaned, lang) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.4,
      max_tokens: 8192,
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
}

const PROVIDERS = [
  { name: 'gemini',   fn: callGemini,   hasKey: () => !!process.env.GEMINI_API_KEY },
  { name: 'groq',     fn: callGroq,     hasKey: () => !!process.env.GROQ_API_KEY },
  { name: 'deepseek', fn: callDeepSeek, hasKey: () => !!process.env.DEEPSEEK_API_KEY }
];

export async function analyzeWithFallback(htmlCleaned, lang = 'es') {
  const attempts = [];

  for (const provider of PROVIDERS) {
    if (!provider.hasKey()) {
      attempts.push({ provider: provider.name, skipped: 'no_key' });
      continue;
    }
    try {
      const t0 = Date.now();
      const parsed = await provider.fn(htmlCleaned, lang);
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

export function listProvidersStatus() {
  return PROVIDERS.map(p => ({
    name: p.name,
    configured: p.hasKey()
  }));
}
