// Chat conversacional usando exclusivamente Gemini.
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function chatWithGemini(prompt, lang = 'es') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: 'gemini-3.6-flash',
    systemInstruction: `Responde como asistente de accesibilidad web. Sé claro, breve y práctico. Responde en ${lang}. No inventes elementos que no aparezcan en el contexto.`,
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 }
  });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
