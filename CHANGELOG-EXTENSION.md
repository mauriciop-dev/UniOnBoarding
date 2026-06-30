# Changelog / Bitacora de problemas y soluciones

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
