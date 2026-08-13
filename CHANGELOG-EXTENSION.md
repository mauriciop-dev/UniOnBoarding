# Changelog / Bitacora de problemas y soluciones

## 0.1.26 — Fix definitivo del sink: entrada de silencio para activar process()

- `numberOfInputs: 0` no alcanzo: la cola seguia creciendo y `process()` no corria.
- Confirmado con fuentes (WebAudio/Chromium): un AudioWorkletNode no recibe `process()` si no tiene por lo menos UNA entrada CONECTADA (y puede entregar outputs vacios).
- Fix: un oscilador conectado al input del sink via un gain en 0 (silencio, inaudible) mantiene el nodo activo para siempre → `process()` corre, la cola drena al parlante.

---

## 0.1.25 — Causa raiz del "no se oye": process() del sink nunca corria

- Hallazgo con la instrumentacion: el AudioContext estaba `running`, el sink recibia todo el PCM (`cola 515042` creciendo) **pero `process()` nunca se ejecutaba** → la cola no se vaciaba al parlante.
- Causa (regla de Chromium): un `AudioWorkletNode` con entradas (default) pero SIN ninguna entrada conectada no recibe llamadas a `process()` (es "inactivo"). El microfono vive en el offscreen (otro AudioContext), asi que el sink del sidepanel quedaba sin entrada.
- Fix: crear el sink como nodo fuente con `{ numberOfInputs: 0, outputChannelCount: [1] }` → el procesador corre siempre y vacia la cola a destination.

---

## 0.1.24 — Diagnostico del sink de reproduccion (Gemini responde pero no se oye)

- Subida RESUELTA: base64 arreglo el audio hacia Gemini (chunk aqui == chunk offscreen, >0) y Gemini responde con `serverContent` + audio.
- Falta el tramo final: la reproduccion local. Se instrumenta:
  - `[proob] AudioContext (reproduccion) estado:` al crear el contexto + `onstatechange` (re-intenta `resume()` si queda `suspended` — sospecha: autoplay del sidepanel).
  - `[proob] play: primer frame pcm16 bytes N rate R` y aviso si no hay `sinkNode`.
  - En el worklet `proob-sink`: `sink: worklet recibiendo mensajes`, `sink: pcm16 #N samples M rate R | cola L` y `sink: process() ACTIVO` (distingue contexto suspendido vs datos rotos vs cola parada).

---

## 0.1.23 — Causa raiz del "no te escucha": ArrayBuffer corrompido en chrome.runtime

- Hallazgo: el microfono SI captura (nivel crudo 61.7%, chunk con peak 13775 al salir del offscreen) **pero el sidepanel recibe ese mismo chunk como 0**.
- Causa: `chrome.runtime.sendMessage` con payload `ArrayBuffer` (offscreen -> sidepanel) entrega el buffer corrompido/neutralizado.
- Fix: el offscreen envia el chunk como **string base64** (clonado binario garantizado) y el sidepanel lo decodifica antes de enviarlo a Gemini (`b64ToBytes`).
- Se compara `chunk aqui` (sidepanel) vs `chunk al salir del offscreen` (offscreen): ahora deben coincidir (>0 ambos).

---

## 0.1.22 — Diagnostico de silencio en la captura del microfono

- `peak: 0` confirma que el microfono del offscreen captura silencio (los chunks fluyen pero son ceros).
- Se instrumenta el grafo de audio en 3 puntos para ubicar donde nace el cero:
  1. **Nivel crudo** `proob:micpeak` (AnalyserNode sobre la stream, antes del worklet) → `nivel microfono crudo (offscreen): N%`.
  2. **Peak del chunk al salir del offscreen** (`msg.peak` en `proob:pcm`).
  3. **Peak recomputado en el sidepanel** (`chunk aqui`) → separa "worklet/stream silenciosa" de "mensajeria pierde datos".
- Ademas, en la pagina de permiso (`request-mic.html`) ahora hay un **medidor de nivel en vivo** con barra: si Chrome captura tu voz en una pagina visible, la barra sube; si queda en 0, el problema es el microfono/Chrome, no el offscreen.
- `getSettings()` del track de audio se loguea en el offscreen (deviceId/sampleRate/channelCount).

---

## 0.1.21 — Diagnostico de amplitud del microfono (Gemini no detecta voz)

- Los chunks PCM llegan al sidepanel pero Gemini no envia `serverContent`. Se instrumento el listener del microfono para reportar:
  - `peak`: amplitud pico de los samples Int16 del chunk (0 = silencio → el audio no sale del microfono / ~10-20k = audio real).
  - `envios fallidos`: cantidad de veces que `sendAudio` devolvio false (ws no abierto) → si crece, el audio no sale del panel.

---

## 0.1.20 — Diagnostico del camino de audio de Gemini Live

- Logs de diagnostico (1 vez por sesion / cada 200 chunks) para ubicar en que tramo falla:
  - `[proob] chunks PCM recibidos en el sidepanel: N` → el micro llega al panel.
  - `[proob] Gemini envio serverContent: ...` → Gemini empezo a responder algo.
  - `[proob] audio de respuesta de Gemini llegando a la sesion` → llego audio para reproducir.
- Nota: intentamos habilitar `inputAudioTranscription` para mostrar lo que Gemini oye, pero la API rechaza el campo en esta version del schema (`1007 Unknown name ... input_audio_transcription`); se quito para no romper el setup. Si queremos transcripcion, hay que pasarla por `generationConfig`/otro campo segun docs vigentes.
- Validado en vivo con el codigo real: conectando -> listo OK, sin regresiones (54/54 + 19/19).

---

## 0.1.19 — Fix crash del worklet de salida (audio de respuesta sin canales)

- El `process()` de `proob-sink` explotaba con `Uncaught TypeError ... 'length'` cuando el nodo quedaba sin canales de salida (nodo huerfano de intentos previos / contexto cerrandose). Ahora se valida `outputs[0]` y sus canales antes de leer `length`.
- `stop()` desconecta explicitamente `_micNode`/`_sinkNode` antes de cerrar el AudioContext, para no dejar worklets de sesiones anteriores procesando.
- Nota: este error aparecia DESPUES de que el audio de respuesta llegaba al sink (el fix 0.1.18 de captura funciona): la meta ahora es que ese audio suene.

---

## 0.1.18 — Fix "escucha pero nunca responde": el worklet de microfono no procesaba

- **CAUSA RAIZ**: en Web Audio, un `AudioWorkletNode` NO ejecuta `process()` si no está conectado a `destination` (no forma parte del grafo de render). El nodo `proob-mic-capture` existia pero nunca generaba chunks de PCM16 → a Gemini jamas le llegaba audio del microfono → "voz activa" pero sin respuesta.
- Fix en `offscreen.js` y en la ruta inline de `realtime-voice.js`: `src.connect(node); node.connect(ctx.destination);` (el nodo emite silencio, no genera eco).
- `_setupAudio`: se reanuda el `AudioContext` si quedó suspended.
- Logs de diagnostico (primer chunk PCM del microfono / primer audio de respuesta de Gemini) para distinguir entrada vs salida en la consola del sidepanel.
- Harness: 54/54 + 19/19 OK.

---

## 0.1.17 — Fix del hang "Conectando..." en Modo Voz

- **CAUSA RAIZ encontrada (validada contra Google con tu key)**: el servidor de Gemini Live entrega los mensajes JSON del WebSocket como **Blob/binario** y se hacía `JSON.parse(ev.data)` directo → el parseo fallaba en silencio → `setupComplete` nunca se procesaba → el panel quedaba "Conectando..." para siempre.
- Los handlers de mensajes de **Gemini Live** y **Deepgram Agent** ahora aceptan string **y** Blob (`messageText`/`await data.text()`), manteniendo el parseo síncrono para strings (no rompe los tests 54/54 y 19/19).
- **Watchdog de conexión**: si en 20 s no llega `setupComplete`, se corta la sesión y el panel muestra "Sin respuesta del servidor (timeout tras 20s)" en vez de quedarse colgado.
- Validado en vivo: importando `realtime-voice.js` (código real) contra la API, con la key de dev y el endpoint `?key=`, la sesión pasa por `conectando → listo` correctamente.

---

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
