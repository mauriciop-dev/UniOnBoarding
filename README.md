# ProOnboarding API

Backend serverless para la extensión Chrome **ProOnboarding**. Recibe un fragmento de HTML simplificado, lo envía a una cadena de proveedores de IA con failover automático (Gemini → Groq → DeepSeek), guarda el resultado en caché en **InsForge** y devuelve un JSON estructurado con el análisis de la página y un recorrido interactivo de onboarding.

---

## Endpoints

### `POST /api/analyze-page`

**Body**
```json
{
  "url": "https://aiprodig.com/",
  "html_cleaned": "<html>...</html>",
  "lang": "es",
  "dom_hash": "optional_sha256"
}
```

**Response 200**
```json
{
  "page_analysis": {
    "detected_platform_name": "...",
    "general_purpose_summary": "...",
    "audio_welcome_script": "..."
  },
  "interactive_tour": [
    {
      "step_number": 1,
      "element_selector": "...",
      "title": "...",
      "text_explanation": "...",
      "audio_script": "...",
      "action_type": "highlight"
    }
  ],
  "_meta": {
    "cached": false,
    "dom_hash": "...",
    "provider": "gemini",
    "elapsed_ms": 2300,
    "attempts": []
  }
}
```

### `GET /api/health`
Estado del servicio, proveedores configurados y conexión a InsForge.

---

## Arquitectura

```
Extensión Chrome
       │
       ▼
  Vercel Function (api/analyze-page.js)
       │
       ├──► InsForge (cache hit?) ──► JSON cacheado
       │                                ▲
       │                                │
       └──► AI provider chain ◄─────────┘
              1. Gemini 1.5 Flash
              2. Groq (llama-3.1-70b)
              3. DeepSeek Chat
              (si uno falla, salta al siguiente)
```

---

## Setup local

```bash
cd C:\proonboarding-api
npm install
cp .env.example .env.local
# Edita .env.local con tus claves reales
npx vercel dev
```

En otra terminal:
```bash
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/analyze-page \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","html_cleaned":"<html><body><h1>Hola</h1></body></html>","lang":"es"}'
```

O usa el script de prueba: `node scripts/test-local.js`

---

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `GEMINI_API_KEY` | Recomendada | API key de Google AI Studio |
| `GROQ_API_KEY` | Recomendada | API key de Groq Cloud (fallback rápido) |
| `DEEPSEEK_API_KEY` | Opcional | API key de DeepSeek (fallback final) |
| `INSFORGE_URL` | Recomendada | URL de tu backend InsForge |
| `INSFORGE_API_KEY` | Recomendada | Project key (`ik_...`) |
| `INSFORGE_ANON_KEY` | Opcional | Anon key (`eyJ...`) |

> El servicio funciona aunque solo haya **una** clave de IA. Si falla, intenta con la siguiente. La respuesta incluye `_meta.attempts` para ver qué proveedor respondió.

---

## Esquema de base de datos (InsForge)

Aplica el contenido de `insforge-schema.sql` en el SQL editor de InsForge o mediante el endpoint raw:

```bash
curl -X POST "$INSFORGE_URL/api/database/advance/rawsql" \
  -H "x-api-key: $INSFORGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'SQL'
{ "query": "<pega aquí el contenido de insforge-schema.sql>" }
SQL
```

Opcional: programa `public.cleanup_old_analyses()` con InsForge Schedules (`0 3 * * *` para ejecutarlo diario a las 3 AM).

---

## Despliegue en Vercel

1. Conecta el repo de GitHub (`mauriciop-dev/UniOnBoarding`) en el dashboard de Vercel.
2. En **Settings → Environment Variables** agrega las 6 variables listadas arriba (mismos nombres y valores que en `.env.local`).
3. Redeploy.

O vía CLI:
```bash
npx vercel link
npx vercel env add GEMINI_API_KEY
npx vercel env add GROQ_API_KEY
npx vercel env add DEEPSEEK_API_KEY
npx vercel env add INSFORGE_URL
npx vercel env add INSFORGE_API_KEY
npx vercel env add INSFORGE_ANON_KEY
npx vercel --prod
```

---

## Estructura

```
proonboarding-api/
├── api/
│   ├── analyze-page.js     ← endpoint principal
│   └── health.js           ← healthcheck con estado de providers e InsForge
├── lib/
│   ├── prompt-template.js  ← prompt validado para todos los providers
│   ├── ai-provider.js      ← cadena Gemini → Groq → DeepSeek con fallback
│   └── insforge-client.js  ← cliente REST para InsForge (cache)
├── insforge-schema.sql     ← SQL para crear la tabla page_analyses
├── scripts/
│   └── test-local.js       ← cliente de prueba contra el endpoint
├── vercel.json             ← config CORS + maxDuration
├── package.json
├── .env.example
└── README.md
```

---

## Notas

- **CORS**: abierto a `*` para que la extensión Chrome pueda llamar desde cualquier sitio. Endurecer a `chrome-extension://...` en producción.
- **Coste estimado**: < $0.001 por análisis con Gemini 1.5 Flash. Groq y DeepSeek tienen free tier generoso.
- **Cache**: si `dom_hash` ya existe en InsForge, devuelve la respuesta cacheada sin llamar a la IA.
- **Validación de shape**: la respuesta de cualquier provider se valida contra el esquema antes de devolverla. Si falta un campo crítico, se considera fallida y se intenta el siguiente provider.
