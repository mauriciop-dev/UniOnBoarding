# Changelog / Bitacora de problemas y soluciones

## 0.1.16 — Diagnóstico de cierre + audio de respuesta de Gemini

- **Gemini Live no reproducía la respuesta por voz**: la sesión no conectaba `onAudio` del provider al worklet de salida (solo se veía el texto por `outputTranscription`). Ahora el audio PCM del `serverContent` se reproduce por el sink.
- **Cierre inesperado ya no queda mudo**: los providers reportan el `code`/`reason` del `onclose` y la UI muestra "La sesión de voz se cerró: <motivo>" en vez de volver en silencio a "Voz desactivada/conectando". Si el servidor cierra (p. ej. por el token efímero), el usuario ve el motivo real.
- **Carrera de arranque corregida**: si la sesión se detiene mientras se prepara el micrófono (offscreen), ya no se abre un WebSocket huérfano que dejaba "Conectando..." eterno; `start()` verifica `_running` antes de conectar.
- `ctx.resume()` en el offscreen para garantizar que el contexto de audio corra aunque el navegador lo ponga en suspenso.

---

## 0.1.15 — Micrófono con offscreen document (patrón oficial de Chrome)

- **El sidepanel y el popup no pueden mostrar el prompt de `getUserMedia`** (bug conocido de Chromium: `NotAllowedError: Permission dismissed` sin preguntar). Solución oficial de Chrome: **capturar el micrófono en un `offscreen document` con razón `USER_MEDIA`** y pedir el permiso una vez desde una página visible (`request-mic.html` abierta en pestaña). El PCM16 viaja del offscreen al sidepanel vía `chrome.runtime.sendMessage` (`proob:pcm`) y de ahí al WebSocket.
- Se agrega la permisión **`offscreen`** al manifest. El service worker crea/cierra el documento (`proob:offscreen`) y la captura responde a `proob:voicestart/stop`.
- Flujo del primer uso: apretar "Hablar" → si el offscreen no puede pedir el permisoo, se abre `request-mic.html` en una pestaña → el usuario hace clic en "Permitir" → vuelve al panel y presiona "Hablar" de nuevo → listo. En navegadores sin offscreen (p. ej. Firefox), sigue funcionando la captura directa del sidepanel.

---

## 0.1.14 — Fix de prueba manual en Chrome

- **`audioCapture` fuera del manifest**: es inválido en extensiones (solo Chrome Apps). Chrome lo rechazaba con `'audioCapture' is only allowed for packaged apps`. El micrófono se captura con `navigator.mediaDevices.getUserMedia` desde el sidepanel; Chrome pide permiso en el primer "Hablar".
- **Errores de voz ya no se ocultan**: `stopVoice()` no pisa un estado `error` con "Voz desactivada"; ahora el usuario ve el mensaje real (p. ej. `Micrófono no disponible: Chrome no concedió el micrófono...`).
- **`/api/voice-token` ahora propaga el motivo real** cuando la API del servidor falla (se muestran el mensaje del server, `HTTP <status>` o timeout) en vez de un "no emite token" genérico.
- **Deepgram `auth/grant` responde 403 (`Insufficient permissions`)**: el key actual no puede emitir tokens efímeros. El endpoint devuelve un mensaje claro al usuario (requiere addon Agent con permiso de grant). **Proveedor recomendado en este estado: Gemini Live** (principal, ya validado).

---

## 0.1.13 — Validación en vivo del token efímero (3 bugs reales corregidos)

- **Schema del setup de Gemini Live estaba mal**: la API rechaza `responseModalities` directo en `setup` (`Unknown name "responseModalities" at 'setup'`). Va dentro de **`generationConfig.responseModalities`** (junto a `speechConfig`). Corregido y verificado contra el WS real.
- **El endpoint REST `auth_tokens` rechaza `liveConnectConstraints`** (`Unknown name at 'auth_token'`): el SDK lo mapea aparte; por REST solo se envían `uses`, `expireTime` y `newSessionExpireTime`. Quitado de `/api/voice-token`.
- **Handshake verificado contra Google real**: mint v1beta → `wss://.../BidiGenerateContentConstrained?access_token=…` → `setupComplete` con `responseModalities:["AUDIO"]` (en Node el primer frame llega como binario; en Chrome llega como texto, el provider ya lo maneja).
- Nota de modelo: `gemini-3.1-flash-live-preview` solo acepta modalidad `AUDIO` (rechaza `TEXT`).

---

## 0.1.12 — Modo Voz sin keys para el usuario (tokens efimeros vía tu API)

- **Problema de producto**: pedirle a un usuario común que genere y pegue una API key hace inviable distribuir la extensión (y expone la key en `chrome.storage`). Corregido con el patrón de **tokens efímeros**:
  - Nuevo endpoint **`POST /api/voice-token`** (Vercel): con tus keys de servidor (`GEMINI_API_KEY` / `DEEPGRAM_API_KEY`) mintea un token de corta vida…
    - **gemini_live** → `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` (`x-goog-api-key`, `uses:1`, constraints `responseModalities:["AUDIO"]`); el cliente conecta a `BidiGenerateContentConstrained?access_token=…`.
    - **deepgram_agent** → `POST https://api.deepgram.com/v1/auth/grant` (`Authorization: Token …`, `ttl:60`); el cliente lo usa en el handshake `Sec-WebSocket-Protocol ['token', access_token]`.
  - **La extensión** (`fetchVoiceToken`) pide el token a tu API en el arranque del Modo Voz. El usuario final **no configura nada**; las claves de Configuración quedan **opcionales** (solo fallback de desarrollo).
- **Principal = Gemini Live** (la opción más económica): ~$0.012–0.023/min de conversación (input $0.005/min + output $0.018/min en `gemini-3.1-flash-live-preview`) vs ~$0.068–0.11/min del Deepgram Agent full-stack. Es el default del selector (etiqueta "más económico").
- `RealtimeVoiceSession` acepta `voiceToken` (`{provider, token, model?}`): reemplaza la key que corresponda y, en Gemini, fuerza el endpoint **Constrained** y el modelo que devuelve el token.
- Validado: 54/54 (providers/sesión) + 18/18 (endpoint `/api/voice-token`, mint + headers + errores). Recoda **desplegar** la API para que el endpoint exista en producción.

---

## 0.1.11 — Deepgram Agent: payload real corregido (think Google con TU Gemini key)

- Mismo error conceptual que la L2 pero en el Agent: el schema de `Settings` no es el que asumimos. Corregido contra la doc real:
  - Endpoint correcto: `wss://agent.deepgram.com/v1/agent/converse` (no `/agent`).
  - `agent.think.provider.type` válidos: `open_ai` | `anthropic` | `aws_bedrock` | `google` | `groq` | `nvidia`. **No existe `type: 'deepgram'`** para "think" (eso rompía la sesión con `FAILED_TO_THINK`).
  - Voz en `agent.speak.provider.model` (no `voice`). Listen por defecto `nova-3` (no `flux-general-multi`).
- **La `GEMINI_API_KEY` se pasa en el payload del `Settings`** (BYO): si el usuario pone su key de Gemini en Ajustes, Deepgram llama a Google con esa key vía `think.endpoint.url` (`https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse`) + `headers.x-goog-api-key`. **No requiere vincular nada en la consola de Deepgram.** Con endpoint propio el `provider.model` no se usa: el modelo va en la URL.
- Si la key de Gemini está vacía, el `think` usa el **Google LLM gestionado por Deepgram** (`type: 'google'`, `model: 'gemini-3.1-flash-lite'`, facturado por Deepgram) — sin key extra.
- El campo "Gemini API key" del panel ahora tiene doble uso (Live y think del Agent); `RealtimeVoiceSession` propaga `geminiKey` al proveedor. Un `Settings JSON` custom se hace **deep-merge** sobre el default (preservando audio, voz y tu key).
- Validado con harness: 48/48 PASS (endpoint, settings BYO/managed, merge parcial, transcripciones y audio).

---

## 0.1.10 — Modo Voz en tiempo real (Gemini Live + Deepgram Agent)

- **Nueva capa L5** en Modo Voz: conversación bidireccional por voz con dos proveedores:
  - `gemini_live`: WebSocket directo `BidiGenerateContent` (`?key=`), mensajes JSON `setup` → `realtimeInput` (PCM16 16 kHz en base64) → `serverContent` (transcripciones + `inlineData` de 24 kHz). Usa la `GEMINI_API_KEY`.
  - `deepgram_agent`: `wss://agent.deepgram.com/agent` con auth por `Sec-WebSocket-Protocol ['token', key]`; primero envía el Settings JSON (STT Deepgram + think Google + speak Aura-2). Salida PCM16 24 kHz.
- **Audio real:** micrófono capturado por AudioWorklet `proob-mic-capture` (PCM16 16 kHz) y respuesta reproducida por `proob-sink` (cola PCM16 → contexto de audio). Ambos re-muestrean según sea necesario.
- **UI en el panel:** barra de voz en el chat (botón Hablar/Detener, selector de proveedor, estado en vivo), y sección "Modo voz (realtime)" en Configuración (Gemini key + modelo, Deepgram key, Settings JSON opcional). Las keys se guardan en `chrome.storage.local`.
- **Transcript en el chat:** las frases del usuario y la respuesta del asistente se van volcando como burbujas del chat; el contexto de la página (plataforma + pasos) se inyecta en el prompt del agente.
- Manifest `0.1.10`, permiso `audioCapture` y `voice-worklet.js` como web-accessible resource.
- Validado con harness (WebSocket mock): setup de ambos proveedores, transcripciones, audio y cierre (35/35 PASS).

---

## 0.1.9 — Deepgram L2 activo en producción

- La key provista daba **401** porque `lib/tts-engines.js` usaba `Authorization: Bearer`; Deepgram REST exige **`Authorization: Token <key>`** (verificado contra su API). Corregido.
- Los modelos `aura-2-thalia-es`/`helios-en`/`luzia-pt`/`lys-fr` **no existen** (400). Catálogo real consultado en `/v1/models` y mapeado por **canonical_name**: `aura-2-selena-es`, `aura-2-thalia-en`, `aura-2-agathe-fr`, `aura-2-cesare-it`, `aura-2-elara-de`, `aura-2-uzume-ja`, `aura-2-beatrix-nl` (pt cae a es).
- Verificado: síntesis OK en es/en/fr/it/de/pt local, y `POST /api/tts` en prod → 200 `audio/mpeg`. Key `DEEPGRAM_API_KEY` agregada a Vercel env (production).

---

## 0.1.8 — Voicebox: contrato real /profiles + /generate/stream

- La capa L3 usaba un contrato genérico (`POST /tts` con `{text, lang}`) que NO existia en Voicebox. Se releyo el repo (`mauriciop-dev/voicebox`, FastAPI en `127.0.0.1:17493`) y se alineo al contrato real: `GET /profiles` (primera voz clonada) y `POST /generate/stream` con `{profile_id, text, language}` → stream `audio/wav` por chunk, header `X-Voicebox-Client-Id: proonboarding-extension`.
- El campo de Configuración ahora es la **URL base** (`http://127.0.0.1:17493`) y el hint documenta el contrato.
- Fallback intacto: si Voicebox no corre o falla, degrada a Web Speech reanudando en el chunk exacto.
- Version bump a `0.1.7`.

**Pendiente de tu lado para probar L3:** instalar el MSI de Voicebox (Windows), crear/clonar una voz y dejar corriendo el servidor.

---

## 0.1.7 — Side Panel v2: espacio hibrido (Inicio / Chat)

- **Barra de pestañas** persistente (Inicio / Chat) al pie del panel: el chat deja de ser una vista aislada y se convierte en el segundo espacio siempre accesible. `showView()` sincroniza la pestaña activa y recuerda la ultima vista de "Inicio" (`lastMainView`).
- **Hero en la vista inicial**: logo grande, titular y 3 chips de características (audio paso a paso, Q&A, resaltado guiado).
- **Tarjetas contextuales en el resumen** (`context-cards`): Plataforma, nº de pasos del recorrido y proveedor IA que respondió.
- **Card "Contexto de esta pagina"** en el chat (colapsable): titulo, plataforma, pasos y boton directo "Iniciar recorrido".
- Version de manifest bump a `0.1.6`.

**Archivos tocados:** `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js`, `extension/manifest.json`.

---

## 0.1.6 — FASE 4: Side panel hibrido, feedback y Voicebox

**Feedback / growth loop:**
- Tarjeta "¿Te resulto util?" en el resumen (5 estrellas + comentario opcional), visible 1 vez cada 24 h (`proob.feedback`).
- Se envia a `POST /api/feedback`; el endpoint valida `rating` 1-5 y guarda en la tabla `feedback` de InsForge (migracion `20260811202037_add-feedback.sql` aplicada). Si InsForge falla, responde `{ok:true, stored:false}` sin romper.
- Enlace "Calificar en Chrome Web Store" apuntando a `https://chromewebstore.google.com/detail/<chrome.runtime.id>`.

**Sugerencias rapidas en el chat:**
- 3 chips contextuales (usan la plataforma detectada) que envian la pregunta de un clic.

**Capa Voicebox (TTS local configurable):**
- `tts-provider.js` gana la capa `VOICEBOX` (entre cloud y Web Speech). Contrato: `POST {text, lang}` -> audio binario. Se usa al no haber conexion o como fallback; ante error degrada a Web Speech con reanudo por chunk.
- Campo "Servidor local de voz (Voicebox)" en Configuracion, persistido (`proob.voiceboxUrl`).

**Archivos tocados:**
- `extension/sidepanel.html` / `.css` / `.js` — feedback, chips, campo voicebox
- `extension/tts-provider.js` — capa VOICEBOX (refactor `_speakEndpoint` generico)
- `api/feedback.js` — endpoint nuevo (CORS, validacion, InsForge)
- `lib/insforge-client.js` — `storeFeedback()`
- `insforge-schema.sql` + `migrations/20260811202037_add-feedback.sql` — tabla `feedback`
- `vercel.json` — maxDuration de `api/feedback.js`

---

## 0.1.5 — FASE 3: UI/UX interactiva y condicional

**Etiquetas dinamicas + mini-avatar en el DOM:**
- `content.js` crea un overlay flotante (`proob-layer`) anclado al elemento del
  tour con una etiqueta tipo chip: mini-avatar + titulo del paso + CTA opcional.
- Reposiciona en scroll/resize; se limpia al cambiar de paso o salir del tour.

**Flujo condicional con ayuda in-page:**
- `wait_for_click`: tras 2 clics fuera del destino o 25s sin accion, el overlay
  muestra "Parece que necesitas ayuda" con botones **Repetir** (re-arma la
  espera) y **Continuar** (resuelve `{ok:false, completed:false}`).
- `input_required`: timeout de 25s -> ayuda con **Volver a intentar** /
  **Saltar** (resuelve `{ok:false, completed:false, skipped:true}`).
- El side panel refleja el resultado en el hint (`action-hint`) sin bloquear el
  recorrido.

**3 avatares semi-transparentes (bot / hombre / mujer):**
- Selector persistente (`proob.avatar`) en el header del tour.
- El avatar cambia el icono del mini-avatar en la pagina (mensaje
  `PROOB_AVATAR`) y la voz de Web Speech (heuristica de genero en
  `tts-provider.js`, best-effort segun voces instaladas).

**Archivos tocados:**
- `extension/content.js` — overlay de etiquetas, ayuda condicional, PROOB_AVATAR
- `extension/content.css` — estilos de label/cta/help
- `extension/sidepanel.js` — selector de avatar, payload de highlight, hints
- `extension/sidepanel.html` — `.avatar-row` en tour-header
- `extension/sidepanel.css` — estilos `.avatar-opt`
- `extension/tts-provider.js` — `voiceGender` + heuristica de voces

**Nota:** FASE 3 es solo cliente (extension). No requiere redeploy del API.
Se valido el flujo con harness de DOM (happy path, ayuda, input, avatar).

---

## 0.1.3 (fix 3) — Inyeccion directa desde onClicked, no via message al background

**Problema:** `openPanelOnActionClick: true` impide que `onClicked` se
dispare. El background nunca obtiene `activeTab`, por lo que cuando el side
panel le pide via mensaje que inyecte, falla porque el background no tiene
permiso.

**Causa raiz:** `setPanelBehavior({ openPanelOnActionClick: true })` hace
que Chrome maneje el clic internamente. El service worker NO recibe el
evento `onClicked`, y sin ese evento, `activeTab` no se otorga al background.

**Solucion definitiva:**
- NO usar `setPanelBehavior` en absoluto
- Todo en `onClicked`: inyectar content script (gesto activo) Y abrir side
  panel sincronamente (sin `await`)
- El `onInstalled` ya no es necesario
- El listener de mensajes `PROOB_INJECT_CS` se mantiene como fallback por
  si el usuario recarga la pagina con el panel abierto

**Flujo correcto:**
1. Usuario hace clic en icono → `onClicked` se dispara
2. `executeScript` + `insertCSS` se invocan (gesto activo) → content script
   inyectado en la pestana activa
3. `sidePanel.open()` se llama sincronamente → panel se abre
4. Cuando el usuario hace clic en "Esta pagina", el content script ya esta
   disponible

**Archivos tocados:**
- `extension/background.js` — onClicked hace inyeccion + open panel
- `extension/sidepanel.js` — extractFromPage mas simple, usa
  chrome.runtime.sendMessage como fallback

**Leccion aprendida:** `activeTab` SOLO se otorga al service worker cuando
recibe un evento de interaccion directa (`onClicked`). NO con
`openPanelOnActionClick`. Si necesitas injectar content script, hazlo
directamente en `onClicked`, no pidas despues.

**Problema:** `chrome.scripting.executeScript` con `activeTab` no funciona
desde el contexto del side panel. El store aprobo la extension pero al
descargarla con otro usuario, el content script no se inyectaba. El error
era "No se pudo acceder al contenido de la pagina".

**Causa:** `activeTab` se otorga al hacer clic en el icono de la extension,
pero el side panel (aunque es una pagina de extension) no hereda el
`activeTab` para `executeScript`. Solo el service worker (background.js)
tiene el contexto de `activeTab` valido.

**Solucion:** El side panel ya no inyecta directamente. Envia un mensaje
`PROOB_INJECT_CS` al background via `chrome.runtime.sendMessage()`. El
background ejecuta `chrome.scripting.executeScript` y responde. El side
panel espera la confirmacion y luego procede con `PROOB_EXTRACT`.

**Archivos tocados:**
- `extension/background.js` — nuevo listener `PROOB_INJECT_CS` que inyecta
  content.js + content.css via `chrome.scripting`
- `extension/sidepanel.js` — `extractFromPage()` llama a
  `ensureContentScript()` que envia mensaje al background

**Leccion aprendida:** `activeTab` + `scripting.executeScript` solo funciona
DESDE EL BACKGROUND SERVICE WORKER, no desde side panel ni popup. Para
inyectar bajo demanda, el side panel debe pedirselo al background via
`chrome.runtime.sendMessage`.

---

## 0.1.3 — Eliminar content_scripts con <all_urls>

## 0.1.3 — Eliminar content_scripts con <all_urls>

**Problema:** Chrome Web Store rechaza o retrasa revision profunda por usar
`content_scripts` con `"matches": ["<all_urls>"]`. Aunque funcional, la
extension queda en "Revision pendiente" por dias.

**Solucion:** Eliminar `content_scripts` del manifest. El content script se
inyecta bajo demanda desde `sidepanel.js` via `chrome.scripting.executeScript`
cuando el usuario hace clic en "Esta pagina". Funciona porque `activeTab`
permite injectar en la pestana activa mientras el side panel esta abierto.

**Archivos tocados:**
- `extension/manifest.json` — eliminar bloque `content_scripts`
- `extension/sidepanel.js` — `extractFromPage()` hace try→sendMessage, si
  falla inyecta y reintenta

**Leccion aprendida:** No usar `<all_urls>` ni `content_scripts` declarativos.
Inyectar desde el side panel o background con `activeTab` + `scripting`.

---

## 0.1.2 — sidePanel.open requiere gesto del usuario sincrono

**Problema:** `chrome.sidePanel.open()` lanzaba:
`Error: sidePanel.open() may only be called in response to a user gesture.`

**Causa:** `openPanelOnActionClick: true` impedia que `onClicked` se ejecutara,
pero cuando intentabamos `sidePanel.open()` manual con `await`, el gesto
del usuario expiraba.

**Solucion final:** Volver a `openPanelOnActionClick: true` (Chrome abre el
panel nativamente). El content script se inyecta desde el side panel cuando
se necesita, no desde background.

**Archivos tocados:**
- `extension/background.js` — solo `setPanelBehavior`, sin onClicked
- `extension/sidepanel.js` — inyeccion on-demand

---

## 0.1.1 — El content script nunca se inyectaba

**Problema:** Error silencioso: al hacer clic en el icono, el side panel se
abria pero content.js no estaba presente. `extractFromPage()` fallaba con
"no se pudo comunicar con la pestana".

**Causa:** `openPanelOnActionClick: true` y `onClicked` son mutuamente
excluyentes. Si ponemos `onClicked` para injectar, el panel no se abre.
Si ponemos `openPanelOnActionClick`, `onClicked` no se dispara.

**Solucion final:** Que el side panel mismo inyecte el content script
on-demand.

**Archivos tocados:**
- `extension/background.js` — quitar onClicked, solo panel behavior
- `extension/sidepanel.js` — injectContentScript() en extractFromPage

---

## 0.1.0 — Gemini Nano y problemas de permiso

**Problema:** La extension usaba Gemini Nano (IA local de Chrome) como
fallback antes de ir a la nube. `aiLanguageModel` en permisos requeria
revision profunda en el store. Ademas, `getNanoAvailability()` y
`detectAvailableEngine()` agregaban latencia innecesaria.

**Solucion:** Eliminar Gemini Nano por completo. Solo cloud API
(Groq → Gemini → DeepSeek). Quitar `aiLanguageModel` del manifest.

**Archivos tocados:**
- `extension/manifest.json` — quitar `aiLanguageModel` de permissions
- `extension/ai-engine.js` — simplificar a solo cloud fetch
- `extension/sidepanel.js` — quitar ENGINE_LABELS, showEngineStatus, etc.
- `extension/sidepanel.html` — quitar engine-status pill
- `extension/sidepanel.css` — quitar estilos de badges de engine

---

## Problemas recurrentes y sus soluciones definitivas

### 1. Content script no disponible en la pestana activa

**Sintoma:** "No se pudo comunicar con la pestana"

**Solucion definitiva:** No declarar content_scripts en manifest. Inyectar
via `chrome.scripting.executeScript` desde el side panel cuando el usuario
hace clic en "Esta pagina". El side panel tiene acceso a `activeTab` porque
la extension fue invocada por el usuario.

```js
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content.css']
  });
  await new Promise(r => setTimeout(r, 150));
}
```

### 2. sidePanel.open no funciona

**Sintoma:** Al hacer clic en el icono, no pasa nada o error de gesto.

**Solucion definitiva:** Usar `setPanelBehavior({ openPanelOnActionClick: true })`
en background.js. NO usar `chrome.action.onClicked` para abrir el panel.
NO usar `await` antes de `sidePanel.open()`.

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
});
```

### 3. Store rechaza por permisos de host

**Sintoma:** "Se retrasara la publicacion — Permisos generales de host"

**Solucion definitiva:**
- NO poner `<all_urls>` en content_scripts
- Mantener `host_permissions` especifico al API:
  `"https://uni-on-boarding-idcs.vercel.app/*"`
- Inyectar content script on-demand con `activeTab` + `scripting`

### 4. Provider timeout vs Vercel maxDuration

**Problema:** 3 providers × 25s timeout = 75s, pero Vercel solo da 30s.

**Solucion:** Reducir `PROVIDER_TIMEOUT` a 10s. Con 3 providers, maximo
30s total + overhead.

### 5. Event listeners de highlight orphaned

**Problema:** Al salir del tour a mitad de un `wait_for_click`, los listeners
quedaban colgados en el DOM, causando potenciales memory leaks.

**Solucion:** Sistema centralizado de `cleanupHandlers()` que registra y
limpia todos los listeners activos.

### 6. Voces TTS no disponibles al primer speak

**Problema:** `window.speechSynthesis.getVoices()` devuelve array vacio
si se llama antes de que Chrome cargue las voces.

**Solucion:** Precargar voces al iniciar el side panel:
```js
function waitForVoices() {
  return new Promise(resolve => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) return resolve();
    window.speechSynthesis.onvoiceschanged = () => resolve();
  });
}
```

### 7. Atributos data-* no disponibles para selectores de IA

**Problema:** La IA no podia generar selectores basados en `data-*`
attributes porque se omitian al limpiar el DOM.

**Solucion:** Funcion `keepAttr()` que incluye tanto los atributos
conocidos como cualquier `data-*`.

### 8. Boton "Iniciar recorrido" visible con 0 pasos

**Problema:** Si la IA devuelve 0 pasos en el tour, el boton aparecia
pero no hacia nada.

**Solucion:** Ocultar el boton con `hidden` cuando `tourSteps.length === 0`.
