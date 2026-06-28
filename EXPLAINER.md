# ProOnboarding — Cómo funciona

> Documento multi-audiencia: empresa · usuario · IA · ingeniero

---

## Para una empresa 🏢

### El problema que resuelve

Cada vez que un cliente nuevo entra a tu plataforma, **se pierde**. Lee un poco, no entiende el flujo, abandona. Tu equipo de soporte recibe las mismas preguntas de siempre. Tu tasa de adopción no sube aunque el producto sea bueno.

ProOnboarding es una **extensión para el navegador Chrome** que funciona como un guía turístico inteligente dentro de cualquier página web. El usuario la activa, y en segundos recibe:

1. **Un resumen en audio y texto** de qué hace la página que tiene en pantalla.
2. **Un recorrido interactivo guiado** que ilumina cada botón, campo o sección y le explica para qué sirve, en su idioma, mientras lo lleva de la mano.

### ¿Qué gana tu empresa?

| Beneficio | Impacto |
|-----------|---------|
| Menos tickets de soporte | Los usuarios se auto-guían sin llamar al equipo |
| Mayor retención | El usuario que entiende el producto se queda |
| Onboarding sin esfuerzo | No tienes que grabar videos ni escribir manuales |
| Funciona en cualquier web | Sin instalar nada en tu plataforma |

### Modelo de negocio (dos capas)

- **Freemium para usuarios**: cualquier persona instala la extensión gratis y la usa en cualquier sitio web público.
- **Premium para empresas (B2B)**: tu empresa contrata acceso a la API y sube documentación oficial o reglas de negocio específicas ("en esta pantalla, resalta el botón de facturación y explica el descuento del 20%"). Cuando un usuario con la extensión visita **tu** plataforma, recibe el onboarding que tú diseñaste, no uno genérico.

---

## Para una persona normal 👤

### ¿Qué es esto en simple?

Imagina que cada vez que entras a una página web nueva o complicada, tuvieras un **asistente que te habla al oído y te muestra exactamente dónde hacer clic**.

Eso es ProOnboarding. Es una extensión (un pequeño programa) que instalas una vez en tu navegador Chrome y ya está lista para usar en cualquier sitio web.

### ¿Cómo la uso?

1. **Instalas** la extensión en Chrome (una sola vez).
2. Cuando entras a una página que no entiendes, **haces clic en el ícono** de ProOnboarding en la barra del navegador.
3. Aparece una **barra a la derecha de la pantalla**.
4. Presionas el botón **"Esta página"**.
5. En pocos segundos, la IA lee la página por ti y te dice en audio y en texto de qué trata.
6. Luego puedes iniciar el **recorrido interactivo**: la extensión va iluminando cada parte de la pantalla y te va explicando para qué sirve cada botón o sección, como si alguien te estuviera enseñando en persona.

### Lo que NO necesitas

- ❌ No necesitas leer manuales
- ❌ No necesitas ver tutoriales en YouTube
- ❌ No necesitas crear ninguna cuenta para usarla en webs públicas
- ❌ No necesitas saber nada de tecnología

---

## Para una IA 🤖

### Descripción del sistema (contexto para agentes)

**ProOnboarding** es una extensión Chrome Manifest V3 + API serverless que realiza análisis semántico de páginas web en tiempo real para generar guías de onboarding interactivas.

#### Componentes del sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER                          │
│                                                                 │
│  ┌────────────────┐    ┌──────────────────────────────────────┐ │
│  │  content.js    │    │           sidepanel.js               │ │
│  │ (IIFE, todas   │◄──►│  UI principal (side panel API MV3)   │ │
│  │  las páginas)  │    │                                      │ │
│  │                │    │  ┌────────────────────────────────┐  │ │
│  │ • cleanDOM()   │    │  │        ai-engine.js            │  │ │
│  │ • highlight()  │    │  │                                │  │ │
│  │ • computeHash()│    │  │  1. LanguageModel.availability()│  │ │
│  └────────────────┘    │  │  2. Gemini Nano (local GPU)    │  │ │
│                        │  │  3. → fallback: POST API cloud  │  │ │
│  ┌────────────────┐    │  └────────────────────────────────┘  │ │
│  │ background.js  │    └──────────────────────────────────────┘ │
│  │ (service worker│                                             │
│  │  abre panel)   │                                             │
│  └────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS POST (fallback)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     VERCEL SERVERLESS (cloud)                   │
│                                                                 │
│  POST /api/analyze-page                                         │
│       │                                                         │
│       ├──► InsForge (dom_hash cache hit?) ──► JSON cached       │
│       │                                                         │
│       └──► AI provider chain (failover):                        │
│               1. Groq  llama-3.3-70b-versatile                  │
│               2. Gemini gemini-2.0-flash                        │
│               3. DeepSeek deepseek-chat                         │
└─────────────────────────────────────────────────────────────────┘
```

#### Schema JSON de salida (invariante entre motores)

```json
{
  "page_analysis": {
    "detected_platform_name": "string",
    "general_purpose_summary": "string (2-3 oraciones)",
    "audio_welcome_script": "string (≤80 palabras)"
  },
  "interactive_tour": [
    {
      "step_number": "integer",
      "title": "string",
      "text_explanation": "string",
      "audio_script": "string",
      "element_selector": "string (CSS selector válido)",
      "action_type": "navigate | wait_for_click | input_required"
    }
  ],
  "_meta": {
    "engine": "nano | cloud",
    "cached": "boolean",
    "provider": "groq | gemini | deepseek (solo en modo cloud)"
  }
}
```

#### Flujo de selección de motor de IA

```
analyzePageWithFallback()
    │
    ├── isNanoAvailable()
    │       └── typeof LanguageModel !== 'undefined'
    │               └── LanguageModel.availability() → 'readily' | 'available'
    │
    ├── [SÍ] → analyzeWithNano(url, html, lang)
    │               └── LanguageModel.create({ expectedOutputLanguages })
    │               └── session.prompt(buildNanoPrompt())
    │               └── extractJsonFromText() + validateNanoResponse()
    │               └── [ERROR] → cae al fallback cloud
    │
    └── [NO] → analyzeWithCloud(url, html, lang, dom_hash, apiUrl)
                    └── fetch POST /api/analyze-page
```

#### Mensajes entre contextos (chrome.tabs.sendMessage)

| Tipo | Dirección | Payload | Respuesta |
|------|-----------|---------|-----------|
| `PROOB_EXTRACT` | sidepanel → content | — | `{ ok, html, dom_hash, url, title }` |
| `PROOB_HIGHLIGHT` | sidepanel → content | `{ selector, action_type }` | `{ ok, completed }` |
| `PROOB_CLEAR_HIGHLIGHT` | sidepanel → content | — | `{ ok }` |

#### Estado de la extensión (state object en sidepanel.js)

```javascript
{
  apiUrl: string,       // URL del endpoint cloud (configurable por usuario)
  lang: string,         // Código ISO del idioma objetivo ('es', 'en', etc.)
  pageUrl: string,      // URL de la página analizada
  pageHtml: string,     // HTML limpio extraído por content.js
  domHash: string,      // Hash djb2 del HTML limpio (para caché)
  analysis: object,     // Respuesta completa del motor de IA
  tourSteps: array,     // interactive_tour del análisis
  currentStep: integer, // Índice del paso activo en el tour
  isSpeaking: boolean   // Estado del TTS (Web Speech API)
}
```

---

## Para un ingeniero 👨‍💻

### Stack y decisiones de arquitectura

#### Extensión Chrome (MV3)

| Archivo | Rol | Notas técnicas |
|---------|-----|----------------|
| `manifest.json` | Declaración de permisos | Permisos: `sidePanel`, `activeTab`, `scripting`, `storage`, `aiLanguageModel` |
| `background.js` | Service Worker | Solo abre el side panel; stateless |
| `content.js` | IIFE inyectada en todas las páginas | No usa `import` (limitación de content scripts). Limpia DOM, computa hash djb2, gestiona highlights y eventos de interacción |
| `ai-engine.js` | Módulo ES (importado por sidepanel) | Encapsula detección de Nano, construcción de prompt, parseo defensivo de JSON y fallback al API cloud |
| `sidepanel.js` | Lógica de UI (ES module) | Máquina de estados con vistas: idle → loading → summary → tour → error |

#### Limpieza del DOM (`cleanDOM` en content.js)

- Recorre el DOM con walk recursivo (max depth: 25)
- Elimina nodos ocultos (`display:none`, `visibility:hidden`, `opacity:0`, `[hidden]`, `aria-hidden`)
- Omite tags no semánticos: SCRIPT, STYLE, SVG, CANVAS, VIDEO, IFRAME, etc.
- Filtra atributos: solo conserva `id`, `class`, `name`, `href`, `type`, `placeholder`, `value`, `role`, `aria-label`, `title`, `alt`, `for`, `src`
- Trunca textos a 220 caracteres
- Hash djb2 del HTML resultante → `dom_hash` para caché

#### Motor de IA con fallback (`ai-engine.js`)

```
Prioridad:
  1. Gemini Nano (LanguageModel API, Chrome built-in)
     - Sin red, sin API key, sin costo, GPU local
     - Requiere: Chrome con flag prompt-api-for-gemini-nano activo
     - Limitación: contexto ~6K tokens (HTML ya viene pre-truncado)
     - Parseo defensivo: regex /\{[\s\S]*\}/ si el modelo añade texto extra

  2. API Cloud (Vercel serverless)
     - POST /api/analyze-page con body: { url, html_cleaned, lang, dom_hash }
     - Chain interna: Groq → Gemini → DeepSeek (failover automático)
     - Caché: InsForge (Supabase-compatible) keyed por dom_hash
```

#### API Serverless en Vercel (`api/analyze-page.js`)

```
Input:  { url, html_cleaned, lang, dom_hash }
Output: { page_analysis, interactive_tour, _meta }

Flujo:
  1. Validación de input
  2. Cache lookup en InsForge por dom_hash
     → HIT: retorna JSON almacenado con _meta.cached=true
     → MISS: continúa
  3. Construye prompt con lib/prompt-template.js
  4. Prueba providers en orden (lib/ai-provider.js):
     Groq (llama-3.3-70b-versatile) → Gemini (gemini-2.0-flash) → DeepSeek (deepseek-chat)
  5. Valida shape del JSON devuelto por la IA
  6. Almacena en InsForge
  7. Retorna respuesta con _meta.provider, _meta.elapsed_ms
```

#### Variables de entorno requeridas

```bash
GEMINI_API_KEY=AIza...       # Google AI Studio
GROQ_API_KEY=gsk_...         # Groq Cloud (llama models)
DEEPSEEK_API_KEY=sk-...      # DeepSeek (fallback final)
INSFORGE_URL=https://...     # Backend de caché (Supabase-compatible)
INSFORGE_API_KEY=ik_...      # Project key
INSFORGE_ANON_KEY=eyJ...     # Anon key (opcional)
```

#### Setup de desarrollo local

```bash
git clone https://github.com/mauriciop-dev/UniOnBoarding
cd UniOnBoarding
npm install
cp .env.example .env.local
# Editar .env.local con las claves reales

# Levantar API local
npx vercel dev

# Probar endpoint
curl http://localhost:3000/api/health
node scripts/test-local.js

# Cargar extensión en Chrome
# chrome://extensions → Modo desarrollador → Cargar sin empaquetar → /extension
```

#### Habilitar Gemini Nano en Chrome (desarrollo)

```
1. chrome://flags/#prompt-api-for-gemini-nano → Enabled
2. chrome://components → "Optimization Guide On Device Model" → Actualizar
3. Reiniciar Chrome
4. Verificar en la consola del service worker de la extensión:
   await LanguageModel.availability() // debe retornar 'readily'
```

#### Diagrama de secuencia completo (happy path con Nano)

```
Usuario           sidepanel.js        content.js         ai-engine.js
   │                   │                  │                    │
   │ clic "Esta página"│                  │                    │
   │──────────────────►│                  │                    │
   │                   │ PROOB_EXTRACT    │                    │
   │                   │─────────────────►│                    │
   │                   │                  │ cleanDOM()         │
   │                   │                  │ computeHash()      │
   │                   │◄─────────────────│                    │
   │                   │ { html, dom_hash }│                    │
   │                   │                  │                    │
   │                   │ analyzePageWithFallback()             │
   │                   │───────────────────────────────────────►
   │                   │                  │  isNanoAvailable() │
   │                   │                  │  LanguageModel.availability()
   │                   │                  │  → 'readily'       │
   │                   │                  │  session.prompt()  │
   │                   │                  │  ← JSON            │
   │                   │◄───────────────────────────────────────
   │                   │ { data, meta: { engine: 'nano' } }    │
   │                   │                  │                    │
   │                   │ updateEngineBadge('nano')             │
   │                   │ renderSummary()  │                    │
   │◄──────────────────│                  │                    │
   │ UI: resumen + badge⚡                │                    │
   │                   │                  │                    │
   │ clic "Iniciar recorrido"             │                    │
   │──────────────────►│                  │                    │
   │                   │ PROOB_HIGHLIGHT  │                    │
   │                   │─────────────────►│                    │
   │                   │                  │ scroll + addClass  │
   │◄─────────────────────────────────────│                    │
   │ elemento iluminado│                  │                    │
   │ TTS reproduce audio│                 │                    │
```

#### Consideraciones para producción

- **CORS**: actualmente `*`. Endurecer a `chrome-extension://<ID>` antes de publicar en Chrome Web Store.
- **Costo estimado**: <$0.001/análisis con Gemini 1.5 Flash. Groq free tier: ~14,400 tokens/min.
- **Tamaño del contexto de Nano**: limitar `html.slice(0, 5000)` en el prompt para no exceder la ventana.
- **Parseo defensivo**: Nano puede responder con texto antes/después del JSON. Usar regex de extracción antes de `JSON.parse()`.
- **Selector fallback pendiente**: si `querySelector(selector)` falla, buscar por texto visible del `title` del paso.
- **Caché local pendiente**: usar `chrome.storage.local` para guardar análisis por `dom_hash` y no rellamar al API en visitas repetidas.

---

## Glosario

| Término | Definición |
|---------|-----------|
| **Gemini Nano** | Modelo de IA de Google que corre directamente en el navegador Chrome, en la GPU del usuario, sin conexión a internet |
| **LanguageModel API** | API experimental de Chrome para acceder a modelos de IA locales |
| **MV3** | Manifest Version 3, la especificación actual de extensiones Chrome |
| **Side Panel** | Barra lateral nativa de Chrome (API `chrome.sidePanel`) |
| **Content Script** | Código JavaScript que Chrome inyecta en las páginas que el usuario visita |
| **Service Worker** | Proceso de fondo de la extensión (background.js) que persiste entre páginas |
| **DOM** | Document Object Model — la estructura en árbol de una página web |
| **dom_hash** | Hash djb2 del HTML limpio de una página, usado como clave de caché |
| **InsForge** | Backend de caché compatible con Supabase, usado para no repetir llamadas a la IA |
| **TTS** | Text-to-Speech — síntesis de voz que lee el texto en voz alta (Web Speech API) |
| **Failover** | Mecanismo automático de respaldo: si un proveedor de IA falla, se prueba el siguiente |
| **IIFE** | Immediately Invoked Function Expression — patrón de JavaScript que evita conflictos de variables en content scripts |

---

*Repositorio: [github.com/mauriciop-dev/UniOnBoarding](https://github.com/mauriciop-dev/UniOnBoarding)*
*API en producción: [uni-on-boarding-idcs.vercel.app](https://uni-on-boarding-idcs.vercel.app)*
