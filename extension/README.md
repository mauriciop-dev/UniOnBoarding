# ProOnboarding - Extensión Chrome (v0.2.0)

Extensión MV3 que consume la API de ProOnboarding desplegada en Vercel. Analiza la página actual, muestra un resumen y guía un recorrido interactivo con audio (TTS) y resaltado visual de elementos.

## Estructura

```
extension/
├── manifest.json              # Manifest V3 (side panel, host_permissions al API)
├── background.js              # Service worker: abre el side panel al hacer clic
├── sidepanel.html             # UI principal del panel lateral
├── sidepanel.css
├── sidepanel.js               # Lógica UI, fetch al API, chat, tour
├── ai-engine.js               # Cliente del API de análisis (cloud)
├── tts-provider.js            # Motor de voz unificado (cloud TTS / Web Speech local)
├── realtime-voice.js          # Modo Voz: Gemini Live + Deepgram Agent (WebSocket)
├── voice-worklet.js           # AudioWorklet: captura del mic (PCM16 16 kHz); la reproducción va por AudioBufferSourceNode
├── content.js                 # Inyectado en cada página: limpieza DOM + overlay + flujo condicional
├── content.css                # Estilos del resaltado, etiquetas, ayuda y toast
├── icons/                     # icon16, icon48, icon128
├── scripts/
│   └── generate-icons.mjs     # Regenera los iconos placeholder
└── README.md
```

## Cargar la extensión en Chrome (modo desarrollador)

1. Abre `chrome://extensions/`.
2. Activa el switch **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar extensión sin empaquetar** y selecciona la carpeta `extension/`.
4. Verás el icono morado con la "P" en la barra del navegador.
5. **Pin** el icono a la barra para acceder más rápido.

> Cada vez que edites un archivo, vuelve a `chrome://extensions/` y pulsa el icono de **recargar** de la extensión.

## Probar contra el API en producción

Por defecto la extensión apunta a:
```
https://uni-on-boarding-idcs.vercel.app/api/analyze-page
```

No hace falta configurar nada extra: las variables de entorno del despliegue ya están activas.

### Flujo de prueba

1. Ve a cualquier web (ej. `https://www.wikipedia.org/` o tu propio sitio).
2. Pulsa el icono de ProOnboarding en la barra → se abre el **side panel** a la derecha.
3. Pulsa **Esta pagina**.
4. Espera 2-10 s. Verás:
   - Nombre detectado de la plataforma
   - Resumen en texto
   - Botón **Iniciar recorrido** y **Audio resumen**
5. Pulsa **Iniciar recorrido**:
   - El paso actual aparece en el panel
   - El elemento correspondiente se **resalta con un borde morado y oscurece el resto**
   - El audio del paso se reproduce automáticamente
   - Si el paso es `wait_for_click`, espera a que hagas clic en el elemento
   - Si el paso es `input_required`, espera a que escribas en el campo
6. Usa **Atrás / Siguiente** o **Salir del recorrido**.

## Probar contra el API en local

Si quieres iterar con el backend en `localhost`:

1. Arranca el API: en la raíz del repo, `npx vercel dev`.
2. En el side panel, pulsa el icono de **Configuración** (engranaje arriba a la derecha).
3. Cambia la URL del API a `http://localhost:3000/api/analyze-page`.
4. Guarda y vuelve a pulsar **Esta pagina**.

> Si Chrome bloquea la llamada a `http://localhost` (mixed content), deja la URL en `https` y usa un tunel tipo `npx vercel dev` con HTTPS, o cambia temporalmente el `host_permissions` del manifest a `http://localhost/*`.

## Configuración

- **URL del API**: por defecto la producción. Cambiable desde el engranaje.
- **Idioma**: `es` (default), `en`, `pt`, `fr`. Afecta al contenido generado por la IA y a la voz TTS.
- **Avatar del asistente**: selector en el header del recorrido (🤖 bot, 👨‍💻 hombre, 👩‍💻 mujer). Persistido localmente (`proob.avatar`). Cambia el mini-avatar flotante en la página y, en lo posible, el género de la voz TTS local (best-effort según voces instaladas).
- **Servidor local de voz (Voicebox, opcional)**: URL **base** del backend FastAPI de Voicebox (`http://127.0.0.1:17493`). Contrato real verificado: `GET /profiles` para resolver la primera voz clonada y `POST /generate/stream` con `{profile_id, text, language}` → stream `audio/wav`. Se usa cuando no hay conexión como fallback antes de las voces del sistema; si falla, degrada a Web Speech reanudando en el chunk exacto.
- **Modo Voz (realtime, FASE 5)** — **sin keys para el usuario**:
  - En producción el Modo Voz pide a tu API (`POST /api/voice-token`) un **token efímero** de corta vida, creado con tus keys de servidor (`GEMINI_API_KEY`/`DEEPGRAM_API_KEY`). El usuario final **no configura nada** y las keys reales nunca salen del servidor.
  - **Principal: Gemini Live** (más económico, ~$0.012–0.023/min): el navegador conecta a `BidiGenerateContentConstrained?access_token=…` con el token mints por el servidor.
  - **Alternativa: Deepgram Agent** (`wss://agent.deepgram.com/v1/agent/converse`): usa el `access_token` del `/v1/auth/grant` en el handshake `Sec-WebSocket-Protocol ['token', token]`. El "think" usa el Google LLM gestionado por Deepgram (sin Gemini key propia).
  - **Campos de Configuración (Gemini/Deepgram/Agent): opcionales, solo fallback de desarrollo** — si tu API no emite token (ej. `vercel dev` sin env), usa las claves locales; si no hay ninguna, avisa. Guardadas en `chrome.storage.local`, nunca a tu backend.

## FASE 5 — Modo Voz en tiempo real

- **Barra de voz en el chat**: botón **Hablar** (mantener la conversación de voz), **Detener**, selector de proveedor (Gemini Live / Deepgram Agent) y estado en vivo (escuchando / respondiendo…).
- **Conversación bidireccional**: el micrófono se captura con un AudioWorklet (PCM16 16 kHz) en un offscreen document y se envía al proveedor; la respuesta de audio se reproduce con `AudioBufferSourceNode` encadenados (remuestreo al rate del contexto con interpolación lineal, sin huecos).
- **Transcript en el chat**: lo que dices y la respuesta del asistente aparecen como burbujas del chat, con el contexto de la página (plataforma + pasos) inyectado en el prompt del agente.
- **Proveedores**:
  - **Gemini Live**: WebSocket `wss://generativelanguage.googleapis.com/ws/.../BidiGenerateContent?key=…` (dev) o `...BidiGenerateContentConstrained?access_token=…` (producción con token efímero); mensajes JSON `setup` → `realtimeInput` → `serverContent` (transcripciones + `inlineData` PCM 24 kHz).
  - **Deepgram Agent**: `wss://agent.deepgram.com/v1/agent/converse`, auth `Sec-WebSocket-Protocol ['token', key|access_token]`, primero un Settings JSON (listen `nova-3` + think Google Gemini + speak Aura-2, salida PCM16 24 kHz). Con token del servidor usa el Google LLM gestionado por Deepgram; en dev, si hay `GEMINI_API_KEY`, se inyecta como BYO (`x-goog-api-key`).
- El manifest expone `voice-worklet.js` como web-accessible resource y pide `offscreen`. El micrófono se captura en un **offscreen document** (razón `USER_MEDIA`) porque Chrome no muestra el prompt de `getUserMedia` en el sidepanel (bug conocido). La primera vez se abre `request-mic.html` en una pestaña para conceder el permiso; después el offscreen graba sin UI y envía el PCM al panel por `chrome.runtime` messaging.

## FASE 4 — Side panel híbrido y crecimiento

- **Espacio híbrido Inicio/Chat**: barra de pestañas persistente. El chat es el segundo espacio, siempre accesible.
- **Hero** en la vista inicial (logo, titular, chips de características).
- **Tarjetas contextuales** en el resumen: Plataforma, pasos del recorrido y proveedor.
- **Card "Contexto de esta página"** en el chat (colapsable) con acceso directo al recorrido.
- **Feedback / growth loop**: tras el análisis (y al terminar el recorrido) aparece una tarjeta "¿Te resultó útil?" con 5 estrellas + comentario opcional. Se envía a `POST /api/feedback` (guardado en InsForge) y un enlace "Calificar en Chrome Web Store" apunta al ID real de la extensión. Se muestra máximo 1 vez cada 24 h.
- **Sugerencias rápidas en el chat**: 3 chips con preguntas contextuales (usando la plataforma detectada) que se envían de un clic.

## Comportamiento del recorrido (FASE 3)

- Cada paso **resalta** su elemento y muestra una **etiqueta flotante** (mini-avatar + título) con una nota contextual (`cta`).
- Flujo condicional:
  - `wait_for_click`: si haces 2 clics fuera del destino o no actúas en 25 s, aparece "Parece que necesitas ayuda" con **Repetir** y **Continuar**.
  - `input_required`: tras 25 s sin escribir, ayuda con **Volver a intentar** y **Saltar**.
- El panel lateral refleja el resultado (skipped/continuado) en el hint, sin bloquear el recorrido.

## Comportamiento esperado

- **Cache**: si vuelves a analizar la misma página, la API devuelve el resultado cacheado y verás una insignia verde "Cache" en el resumen.
- **Selector inválido**: si la IA devuelve un selector que no existe en el DOM (versión de la página cambió, contenido dinámico no cargado, etc.), aparece un toast en la esquina inferior derecha con el selector. El recorrido continúa.
- **Sitios con contenido bloqueado**: webs con `X-Frame-Options` o con mucho contenido dinámico (SPAs que cargan tras JS) pueden no analizarse bien. Se recomienda esperar a que la página termine de cargar antes de pulsar el botón.

## Limitaciones conocidas (v0.1.0)

- TTS usa la **Web Speech API** del navegador: depende de las voces instaladas en el sistema. En Windows suelen venir voces en español decentes.
- El resaltado usa `querySelector` exacto del API. No hay sistema de fallback por texto/posición todavía.
- No hay detección de frustración ni auto-activación (v0.1.0 es solo bajo demanda).
- Sin analytics, sin auth, sin sincronización entre dispositivos.

## Regenerar los iconos

Los iconos actuales son placeholder. Para reemplazarlos con un diseño propio, sobrescribe los archivos en `extension/icons/` (mismos nombres). Para regenerar los placeholders:

```bash
node extension/scripts/generate-icons.mjs
```

## Próximos pasos sugeridos

- [ ] Fallback de selector por texto visible cuando el `querySelector` falle
- [ ] Reintento automático si el primer proveedor de IA falla (ya lo hace el backend, pero exponer el `_meta.attempts` en la UI)
- [ ] Highlight de elementos no interactivos (heading, section, paragraph)
- [ ] Onboarding contextual: si la IA detecta un campo vacío crítico, sugerirlo
- [ ] Soporte para grabar la respuesta del usuario y traducir al idioma destino
