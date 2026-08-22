// Integración única con Gemini. No hay fallback a otros proveedores.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt-template.js';

const TIMEOUT_MS = 25_000;

function extractJson(text) {
  try { return JSON.parse(text); } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini no devolvió JSON válido');
    return JSON.parse(match[0]);
  }
}

function validateShape(value) {
  if (!value || typeof value !== 'object') throw new Error('Respuesta vacía de Gemini');
  if (typeof value.message !== 'string' || !value.message.trim()) throw new Error('Falta message');
  if (value.target) {
    if (typeof value.target.selector !== 'string' || !value.target.selector.trim()) throw new Error('target.selector inválido');
    if (!['click', 'input', 'highlight'].includes(value.target.action_type)) value.target.action_type = 'highlight';
  }
  if (!Array.isArray(value.suggestions)) value.suggestions = [];
  value.suggestions = value.suggestions.slice(0, 3).filter(s => s && s.label && s.intent);
  value.needs_clarification = Boolean(value.needs_clarification || !value.target);
  return value;
}

export async function resolveIntent({ html, intent, lang = 'es', previousAction = '' }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: 'gemini-3.6-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 1200 }
    });
    const result = await model.generateContent(
      buildUserPrompt({ html, intent, lang, previousAction }),
      { signal: controller.signal }
    );
    return validateShape(extractJson(result.response.text()));
  } finally {
    clearTimeout(timer);
  }
}

export async function listProvidersStatus() {
  const configured = Boolean(process.env.GEMINI_API_KEY);
  return [{ name: 'gemini', configured, reachable: configured }];
}
