# STATUS — ProOnboarding

> **Convención**: cuando el usuario escriba **"retomar"**, leer este archivo completo antes de responder. Contiene el estado del proyecto, problemas conocidos y próximos pasos.

Última actualización: 2026-06-02.

---

## 1. ¿Qué es ProOnboarding?

Extensión Chrome (MV3) + API serverless en Vercel que analiza cualquier página web con IA y guía al usuario con un recorrido interactivo (audio TTS + resaltado de elementos).

- **Repo**: https://github.com/mauriciop-dev/UniOnBoarding
- **API producción**: https://uni-on-boarding-idcs.vercel.app
- **Owner**: mauriciop-dev

---

## 2. Estructura del repositorio

```
proonboarding-api/
├── api/
│   ├── analyze-page.js     ← endpoint principal POST
│   └── health.js           ← GET /api/health
├── lib/
│   ├── prompt-template.js  ← prompt del sistema (JSON schema estricto)
│   ├── ai-provider.js      ← cadena Groq → Gemini → DeepSeek
│   └── insforge-client.js  ← cliente REST para InsForge (caché)
├── extension/              ← Extensión Chrome MV3
│   ├── manifest.json
│   ├── background.js       ← service worker (abre side panel)
│   ├── sidepanel.html / .css / .js
│   ├── content.js / .css   ← inyectado en cada página
│   ├── dom-cleaner.js      ← (ELIMINADO, ahora inline en content.js)
│   ├── icons/icon{16,48,128}.png
│   ├── scripts/generate-icons.mjs
│   └── README.md
├── insforge-schema.sql
├── vercel.json
├── package.json
├── .env.example
├── .gitignore              ← incluye "nul" (archivo huérfano Windows)
├── STATUS.md               ← este archivo
└── README.md
```

---

## 3. Lo que YA funciona

✅ **API desplegada en Vercel** (commit `5cec567`, v0.2.0)
✅ **Endpoint `/api/health`** responde 200 con estado de los 3 providers e InsForge
✅ **Caché en InsForge** funcional (tabla `page_analyses` con `dom_hash`)
✅ **Extensión Chrome carga correctamente** en modo unpacked
✅ **Side panel se abre** al hacer clic en el icono
✅ **Botón "Esta página"** extrae el DOM limpio y lo envía al API
✅ **Content script** resalta elementos y maneja `wait_for_click` e `input_required`
✅ **TTS** con Web Speech API (voces del sistema)
✅ **Groq responde** con `llama-3.3-70b-versatile` y devuelve JSON válido del schema
✅ **CORS abierto** a `*` para que la extensión pueda llamar desde cualquier sitio

### Commits importantes (de más reciente a más antiguo)

| Hash      | Mensaje                                                                          |
|-----------|----------------------------------------------------------------------------------|
| `bb8ca77` | fix(ai-provider): reorder chain so Groq is primary, Gemini as fallback           |
| `c71f66f` | fix(ai-provider): update model names to current (gemini-2.0-flash, llama-3.3-70b-versatile) |
| `a67549c` | fix(extension): inline dom-cleaner into content.js                               |
| `cb8c6f6` | feat: Chrome extension v0.1.0 (MV3 side panel)                                  |
| `5cec567` | feat: ProOnboarding API v0.2.0                                                   |

---

## 4. Problema actual (lo que se rompió)

**Síntoma**: después de UNA respuesta exitosa de Groq (~1.5s, 6 pasos de tour), la extensión ahora muestra **"Todos los proveedores de IA fallaron"** consistentemente.

**Causa probable**: rate limit / quota de Groq free tier. Las claves gratuitas tienen límites muy bajos por minuto/día. Una sola llamada con prompt largo (~2000 tokens de system prompt + HTML) puede agotar la cuota rápidamente.

**Estado real de los 3 providers** (verificado con `curl` al endpoint):

| Provider  | Modelo                  | Estado                                                                |
|-----------|-------------------------|-----------------------------------------------------------------------|
| Groq      | `llama-3.3-70b-versatile` | ⚠️ Funcionó 1 vez, luego rate limit (free tier muy restringido)       |
| Gemini    | `gemini-2.0-flash`        | ❌ 429 quota: 0 (este modelo ya no está en free tier)                |
| DeepSeek  | `deepseek-chat`           | ❌ 402 Insufficient Balance (cuenta sin saldo)                        |

**Cadena actual en `lib/ai-provider.js`**: `Groq → Gemini → DeepSeek` (orden cambiado en `bb8ca77`).

---

## 5. Idea del usuario para resolverlo

El usuario mencionó que **Google está desplegando Gemini Nano en Chrome** (integrado en el navegador, sin API key, sin costos). Si el navegador lo soporta, se podría usar como provider principal o único, eliminando la dependencia de servicios externos.

### Prompt API de Chrome (Built-in AI)

- Disponible detrás de un flag/origin trial en algunas versiones de Chrome
- Acceso desde la extensión con `window.ai.languageModel` (o similar) o a través de `chrome.aiOriginTrial`
- Modelos: Gemini Nano (on-device)
- Sin rate limit, sin costo, sin latencia de red
- Limitaciones: ventana de contexto menor, solo en navegadores compatibles

### Pasos para investigarlo cuando se retome

1. Verificar si el Chrome del usuario tiene el flag: `chrome://flags/#prompt-api-for-gemini-nano`
2. Activar y reiniciar Chrome
3. Confirmar versión de Chrome (necesita ~127+ con flag, o join al origin trial)
4. Probar en consola: `await window.ai.languageModel.capabilities()`
5. Si está disponible, crear un cuarto provider en `lib/ai-provider.js` que use la API built-in
6. Hacer ese provider el primero de la cadena (o el único si es suficiente)
7. Mantener Groq/Gemini/DeepSeek como fallback para navegadores sin Nano

### Referencia

- https://developer.chrome.com/docs/ai/built-in-apis
- https://developer.chrome.com/docs/ai/prompt-api
- Origin trial: https://developer.chrome.com/origintrials/#/view_trial/3378833026832343057

---

## 6. Próximos pasos (en orden de prioridad)

### Inmediato (cuando se retome)

- [ ] **Confirmar disponibilidad de Gemini Nano** en el Chrome del usuario
- [ ] Si Nano está disponible: implementar provider built-in
- [ ] Si Nano NO está disponible: evaluar plan pago de Groq o Gemini (Groq Dev tier es $0.59/M tokens, suficiente para testear)

### Corto plazo

- [ ] Manejar el caso de rate limit de Groq con **retry exponencial** antes de saltar al siguiente provider
- [ ] **Cachear localmente** los `dom_hash` ya analizados (en `chrome.storage.local`) para no volver a llamar a la API en análisis repetidos
- [ ] Mostrar en la UI qué provider respondió (ya viene en `_meta.provider`, solo hay que mostrarlo)
- [ ] **Fallback de selector**: si `querySelector` falla en el content script, buscar por texto visible del `title` del paso
- [ ] Soporte para `lang` automático según el idioma de la página (usar `document.documentElement.lang`)

### Medio plazo (mejoras de producto)

- [ ] **Detección de frustración**: si el usuario hace clic 3 veces en un botón sin cambio, auto-activar el tour
- [ ] **Onboarding contextual proactivo**: al detectar un campo crítico vacío, sugerir acción
- [ ] **Dashboard para empresas premium** (capa B2B mencionada en `IdeaInicial.txt`)
- [ ] **Traducción automática** del audio a idioma del usuario
- [ ] **Persistencia del tour**: si el usuario cierra y vuelve, ofrecer continuar donde quedó

### Limpieza técnica pendiente

- [ ] Quitar `nul` del repo si vuelve a aparecer (ya está en `.gitignore`)
- [ ] Agregar tests unitarios para `validateShape` y `cleanDOM`
- [ ] Lint con ESLint en CI
- [ ] Empaquetar la extensión para distribución (`.zip` y publicarla en Chrome Web Store)

---

## 7. Variables de entorno (referencia)

Definidas en Vercel (Settings → Environment Variables):

| Variable             | Estado       | Notas                                          |
|----------------------|--------------|------------------------------------------------|
| `GROQ_API_KEY`       | ✅ configurada | `gsk_...`                                       |
| `GEMINI_API_KEY`     | ✅ configurada | `AIza...`                                       |
| `DEEPSEEK_API_KEY`   | ✅ configurada | `sk-...` (cuenta sin saldo)                     |
| `INSFORGE_URL`       | ✅ configurada |                                                |
| `INSFORGE_API_KEY`   | ✅ configurada | `ik_...`                                        |
| `INSFORGE_ANON_KEY`  | ✅ configurada | `eyJ...` (opcional)                             |

---

## 8. Decisiones de diseño importantes

- **MV3 side panel** en vez de popup: según `IdeaInicial.txt`, barra lateral es el estándar moderno y permite mantener el tour activo mientras el usuario navega.
- **CORS abierto a `*`**: permite que la extensión funcione en cualquier web. Para producción real, endurecer a `chrome-extension://...`.
- **TTS con Web Speech API**: gratis, sin API key, pero depende de voces del SO. Para mejor calidad, considerar Google Cloud TTS o ElevenLabs en futuro.
- **Content script como IIFE**: Chrome no soporta `import` en content scripts (bug que ya se arregló inlineando `dom-cleaner`).
- **Selector CSS del API**: confiamos en que la IA devuelve selectores válidos. Si no, mostrar toast y continuar.
- **InsForge como caché**: clave es el `dom_hash` (sha256 del HTML limpio). Hit de caché ahorra la llamada a la IA.

---

## 9. Comandos útiles

```bash
# Desarrollo local del API
npx vercel dev
# Health check local
curl http://localhost:3000/api/health
# Test analyze local
node scripts/test-local.js

# Despliegue producción
npx vercel --prod

# Ver logs de un deployment
# Ir a https://vercel.com/mauriciop-dev/uni-on-boarding-idcs

# Regenerar iconos placeholder
node extension/scripts/generate-icons.mjs
```

---

## 10. Próxima sesión — checklist

Cuando el usuario escriba "retomar":

1. **Leer este archivo completo** ✅
2. Preguntar qué quiere atacar primero (Nano, rate limit, otra cosa)
3. Si va por Nano: guiar paso a paso la verificación de disponibilidad
4. Si va por rate limit: decidir entre plan pago o implementar retry/backoff
5. Hacer commit pequeño y verificable por cambio
6. Probar en la extensión antes de cerrar la sesión
