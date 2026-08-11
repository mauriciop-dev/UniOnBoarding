# Changelog / Bitacora de problemas y soluciones

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
