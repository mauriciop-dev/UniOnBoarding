# STATUS — ProOnboarding

> **Convención**: cuando el usuario escriba **"retomar"**, leer este archivo completo antes de responder. Contiene el estado del proyecto, problemas conocidos y próximos pasos.

Última actualización: 2026-08-11 (v2.0 — Fases 0–4 + FASE 5 Modo Voz).

---

## 1. ¿Qué es ProOnboarding?

Extensión Chrome (MV3) + API serverless en Vercel que analiza cualquier página web con IA y guía al usuario con un recorrido interactivo (audio TTS + resaltado de elementos + chat Q&A).

- **Repo**: https://github.com/mauriciop-dev/UniOnBoarding
- **API producción**: https://uni-on-boarding-idcs.vercel.app
- **Vercel**: scope `mauricios-projects-d3659c9b` / proyecto `uni-on-boarding-idcs`
- **Owner**: mauriciop-dev

---

## 2. Estructura del repositorio

```
proonboarding-api/
├── api/
│   ├── analyze-page.js     ← endpoint principal POST (análisis + tour)
│   ├── chat.js             ← POST /api/chat (modo Q&A interactivo)
│   ├── feedback.js         ← POST /api/feedback (calificaciones / growth loop)
│   ├── health.js           ← GET /api/health (estado de providers)
│   ├── tts.js              ← POST /api/tts (síntesis cloud, capa L2)
│   └── voice-token.js      ← POST /api/voice-token (tokens efímeros para Modo Voz)
├── lib/
│   ├── prompt-template.js  ← prompt del sistema (JSON schema estricto)
│   ├── ai-provider.js      ← cadena Groq → Gemini → DeepSeek → Bedrock (retry/backoff 25s)
│   ├── chat.js             ← cadena conversacional de chat (mismos 4 providers)
│   ├── cors.js             ← CORS restringido (chrome-extension://, localhost, vercel.app)
│   ├── tts-engines.js      ← motores de TTS cloud (Deepgram)
│   └── insforge-client.js  ← cliente REST para InsForge (caché + feedback)
├── migrations/             ← migraciones SQL aplicadas (feedback en 20260811202037)
├── extension/              ← Extensión Chrome MV3
│   ├── manifest.json
│   ├── background.js       ← service worker (abre side panel + inyecta content)
│   ├── sidepanel.html / .css / .js  ← UI: resumen, tour, chat, avatar
│   ├── ai-engine.js        ← cliente del API de análisis
│   ├── tts-provider.js     ← motor de voz por capas (L1 gemini_live / L2 cloud / L3 local)
│   ├── realtime-voice.js   ← Modo Voz: Gemini Live + Deepgram Agent (WebSocket)
│   ├── voice-worklet.js    ← AudioWorklets: captura del mic (PCM16) y sink de reproducción
│   ├── content.js / .css   ← limpieza DOM + overlay de etiquetas + flujo condicional
│   ├── icons/icon{16,48,128}.png
│   ├── scripts/generate-icons.mjs
│   └── README.md
├── insforge-schema.sql
├── vercel.json             ← maxDuration por función
├── package.json
├── .env.local              ← NO subir a git (contiene claves)
├── .env.example
├── STATUS.md               ← este archivo
├── AjustesAgosto.txt       ← ruta/arquitectura v2.0 (hoja de ruta)
└── README.md
```

---

## 3. Lo que YA funciona (v2.0)

✅ **API desplegada en Vercel** con 4 providers en cadena: **Groq → Gemini → DeepSeek → Bedrock Nova (texto)**. Retry/backoff + presupuesto total de 25 s por análisis (`lib/ai-provider.js`).

✅ **Healthcheck** (`/api/health`) reporta los 4 providers reachable (incluye mini-Converse a Bedrock).

✅ **Caché**: InsForge (`page_analyses` con `dom_hash`) + caché local 24 h en `chrome.storage.local`.

✅ **CORS endurecido** vía `lib/cors.js` (chrome-extension://, localhost, vercel.app).

✅ **Extensión** (MV3, side panel): análisis, resumen con chip de provider, tour interactivo.

✅ **TTS por capas** (`tts-provider.js`): L1 Gemini Live (stub, inactivo), L2 cloud (`/api/tts` Deepgram, pendiente key), L3 Web Speech local (activo por defecto). Chip `#tts-layer` muestra la capa activa.

✅ **Chat Q&A** (FASE 2): `POST /api/chat` + vista de chat en el panel (burbujas, historial por turnos, indicador "escribiendo").

✅ **FASE 3 (UI/UX interactiva y condicional)**:
- Etiquetas dinámicas + mini-avatar sobre el elemento resaltado (overlay `proob-layer`).
- Flujo condicional: 2 clics fuera o 25 s sin acción → ayuda in-page con **Repetir**/**Continuar** (y **Saltar** en `input_required`).
- 3 avatares semi-transparentes (🤖 bot / 👨‍💻 hombre / 👩‍💻 mujer), persistentes, con voz Web Speech según género (best-effort).

✅ **FASE 4 (parcial)**:
- **Side Panel v2**: espacio híbrido con barra de pestañas persistente **Inicio / Chat**; hero en la vista inicial; tarjetas contextuales en el resumen (plataforma, pasos, proveedor); card colapsable "Contexto de esta página" en el chat con acceso al recorrido.
- **Feedback / growth loop**: tarjeta de estrellas + comentario en el panel (1 vez/24 h), `POST /api/feedback` → tabla `feedback` en InsForge (migración aplicada, verificado `stored:true`). Enlace a Chrome Web Store con el ID real de la extensión.
- **Sugerencias rápidas** en el chat (chips contextuales con la plataforma detectada).
- **Capa Voicebox** configurable en `tts-provider.js` (L3): **contrato real verificado** en `mauriciop-dev/voicebox` → `GET /profiles` (primera voz clonada) + `POST /generate/stream` con `{profile_id, text, language}` → WAV stream por chunk (header `X-Voicebox-Client-Id`). URL base configurable en Configuración (`http://127.0.0.1:17493`). Degrada a Web Speech si falla.
- **L2 Deepgram (ACTIVO en prod)**: `lib/tts-engines.js` sintetiza con modelos **Aura-2** verificados vía catálogo real (`/v1/models`), auth `Authorization: Token <key>` (no Bearer), modelos por canonical_name (`aura-2-selena-es`, `aura-2-thalia-en`, etc.; pt cae a es). Verificado: `POST /api/tts` en prod → 200 `audio/mpeg` (26 KB). Key `DEEPGRAM_API_KEY` añadida a Vercel env (production).

✅ **FASE 5 — Modo Voz en tiempo real (implementado, código + harness)**:
- `realtime-voice.js` (L1 Gemini Live directo + Deepgram Agent API) y `voice-worklet.js` (captura PCM16 16 kHz + sink remuestreado). 
- **Gemini Live**: WebSocket `BidiGenerateContent` con `?key=` (usa la `GEMINI_API_KEY` ya configurada), mensajes JSON `setup` → `realtimeInput` → `serverContent` (transcripciones + audio 24 kHz).
- **Deepgram Agent**: `wss://agent.deepgram.com/v1/agent/converse`, auth `Sec-WebSocket-Protocol ['token', key]` + Settings JSON (listen `nova-3` + think Google Gemini + speak Aura-2). La `GEMINI_API_KEY` del usuario se inyecta en el **payload del think** (`think.endpoint.headers['x-goog-api-key']`, BYO) — **sin vinculación en la consola de Deepgram**; si está vacía, usa el Google LLM gestionado por Deepgram.
- UI integrada en el panel: barra de voz en el chat (Hablar/Detener, selector de proveedor, estado) y campos en Configuración (Gemini key/modelo, Deepgram key, Settings JSON). Transcript vuelca al chat con contexto de la página.
- Manifest `0.1.12` (`audioCapture` + `voice-worklet.js` web-accessible).
- **Tokens efímeros (sin keys para el usuario)**: `POST /api/voice-token` mintea tokens de corta vida con tus keys de servidor (Gemini `auth_tokens` constrained / Deepgram `auth/grant`). La extensión pide el token en el arranque; **el usuario no configura nada**. Claves locales opcionales (solo dev). **Principal: Gemini Live** (la más económica, ~$0.012–0.023/min).
- Validado con harness WebSocket mock + endpoint (`/api/voice-token`): 72/72 PASS. **Pendiente: deploy de la API** (para que el endpoint exista en prod) y prueba en vivo en Chrome.

---

## 4. Estado de los providers (verificado en prod)

| Provider  | Modelo                  | Estado                                                |
|-----------|-------------------------|-------------------------------------------------------|
| Groq      | `llama-3.3-70b-versatile` | ✅ reachable (principal)                              |
| Gemini    | `gemini-2.0-flash`        | ✅ reachable (fallback 2)                             |
| DeepSeek  | `deepseek-chat`           | ✅ reachable (fallback 3)                             |
| Bedrock   | `AWS_BEDROCK_MODEL_ID`    | ✅ reachable (4º fallback, NOVA con clave ABSK solo texto) |

> Nota: Bedrock Nova solo sirve texto vía Converse (clave ABSK). Para **voz** (Nova Sonic) se requiere credencial IAM SigV4; ya cubierto alternativamente por Deepgram L2 y el Modo Voz (Gemini Live / Deepgram Agent).

---

## 5. Idea pendiente de explorar (incompleta)

**Gemini Nano (Built-in AI de Chrome)** — el usuario mencionó desplegarlo en Chrome sin API key. Si el navegador lo soporta, sería provider local sin costo. Referencia: `https://developer.chrome.com/docs/ai/built-in-apis`.

---

## 6. Próximos pasos (en orden de prioridad)

### FASE 4 (siguiente, según `AjustesAgosto.txt`)
- [x] **Feedback / growth loop** (estrellas + comentario + enlace a store) con persistencia en InsForge.
- [x] **Sugerencias rápidas** en el chat (chips contextuales).
- [x] **Side Panel v2**: rediseño visual completo que combine chat + tarjetas contextuales.
- [x] **Capa Voicebox** configurable con el **contrato real** (`GET /profiles` + `POST /generate/stream`). Repo `mauriciop-dev/voicebox` accesible y alineado.
- [x] **L1 Gemini Live** (FASE 5): WebSocket directo con `GEMINI_API_KEY` (sin IAM). + **Deepgram Agent** como segundo proveedor (think Google BYO con tu Gemini key en el payload, sin consola).
- [ ] Probar el Modo Voz en vivo en Chrome (mic + reproducción) y ajustar worklets si es necesario.
- [x] **L2 Deepgram (producción)**: modelos Aura-2 reales, auth `Token`, verificado en prod.

### Pendientes técnicos / producto
- [ ] Fallback de selector por texto visible cuando `querySelector` falle.
- [ ] Soporte `lang` automático según la página (`document.documentElement.lang`).
- [ ] Detección de frustración / onboarding contextual proactivo.
- [ ] Tests unitarios para `validateShape` / `cleanDOM`; lint en CI.
- [ ] Empaquetar y publicar en Chrome Web Store.

---

## 7. Variables de entorno

Definidas en Vercel (Settings → Environment Variables) y en `.env.local` (NO subir a git):

| Variable               | Estado        | Notas                                        |
|------------------------|---------------|----------------------------------------------|
| `GROQ_API_KEY`         | ✅ configurada | `gsk_...`                                     |
| `GEMINI_API_KEY`       | ✅ configurada | `AIza...`; también usada por Gemini Live (Modo Voz) |
| `DEEPSEEK_API_KEY`     | ✅ configurada | `sk-...`                                      |
| `AWS_BEDROCK_API_KEY`  | ✅ configurada | Sensitive; solo texto (Converse)              |
| `AWS_BEDROCK_REGION`   | ✅ configurada |                                              |
| `AWS_BEDROCK_MODEL_ID` | ✅ configurada |                                              |
| `DEEPGRAM_API_KEY`     | ✅ configurada | L2 `/api/tts` y Modo Voz Agent                 |
| `INSFORGE_URL`         | ✅ configurada |                                              |
| `INSFORGE_API_KEY`     | ✅ configurada | `ik_...`                                      |
| `INSFORGE_ANON_KEY`    | ✅ configurada | `eyJ...` (opcional)                           |

---

## 8. Decisiones de diseño importantes

- **MV3 side panel** en vez de popup (estándar moderno; mantiene el tour activo al navegar).
- **Cadena de 4 providers** con retry/backoff y presupuesto total: un fallo no rompe el análisis.
- **CORS endurecido** por denylist de orígenes conocidos (chrome-extension://, localhost, vercel.app).
- **TTS por capas** con degradación automática cloud → local y reanudo por chunk.
- **Avatar persistente** (`proob.avatar`) → icono en overlay + género de voz Web Speech (best-effort).
- **InsForge como caché** de 2º nivel; caché local como 1º nivel.

---

## 9. Problemas conocidos

- **`.env.local`**: `vercel link --yes` puede regenerarlo añadiendo entradas `VERCEL_*`. Revisar duplicados antes de desplegar. Nunca commitear.
- **Modo Voz**: código y worklets listos, validados solo con mock. Requiere **prueba en vivo en Chrome** (permiso de micrófono). Deepgram Agent: el "think" con Google usa tu `GEMINI_API_KEY` directamente en el payload (BYO) — la consola de Deepgram **no** se toca.
- **`.gitignore`** incluye `nul` (archivo huérfano Windows) si reaparece.

---

## 10. Comandos útiles

```bash
# Desarrollo local del API
npx vercel dev
# Health check
curl https://uni-on-boarding-idcs.vercel.app/api/health
# Chat
curl -X POST https://uni-on-boarding-idcs.vercel.app/api/chat -H "Content-Type: application/json" \
  -d '{"message":"Hola","lang":"es"}'
# Despliegue producción
npx vercel --prod
# Regenerar iconos
node extension/scripts/generate-icons.mjs
```

---

## 11. Próxima sesión — checklist

Cuando el usuario escriba **"retomar"**:

1. **Leer este archivo completo** ✅
2. Confirmar en qué fase se sigue (por defecto **FASE 4** del documento `AjustesAgosto.txt`).
3. Si se retoma algo de voz: tener a mano `DEEPGRAM_API_KEY` o credencial IAM.
4. Revisar `.env.local` antes de desplegar (posibles duplicados tras `vercel link`).
5. Hacer commits pequeños y verificables por cambio, y probar en la extensión antes de cerrar la sesión.