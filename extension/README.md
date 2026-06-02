# ProOnboarding - Extensión Chrome (v0.1.0)

Extensión MV3 que consume la API de ProOnboarding desplegada en Vercel. Analiza la página actual, muestra un resumen y guía un recorrido interactivo con audio (TTS) y resaltado visual de elementos.

## Estructura

```
extension/
├── manifest.json              # Manifest V3 (side panel, host_permissions al API)
├── background.js              # Service worker: abre el side panel al hacer clic
├── sidepanel.html             # UI principal del panel lateral
├── sidepanel.css
├── sidepanel.js               # Lógica UI, fetch al API, TTS, tour
├── content.js                 # Inyectado en cada página: limpieza DOM + overlay
├── content.css                # Estilos del resaltado y toast
├── dom-cleaner.js             # Utilidad para serializar DOM limpio
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
