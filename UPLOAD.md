# Subir ProOnboarding v0.2.0 a la Chrome Web Store

> Checklist paso a paso para publicar la version 0.2.0 con integracion WebMCP.

## Archivos listos

- **`proonboarding-0.2.0.zip`** (47 KB, 19 entradas) - el paquete a subir
- **`STORE-LISTING.md`** - textos para nombre, descripcion, justificaciones
- **`PRIVACY.md`** - politica de privacidad

## Pasos en la consola de Chrome Web Store

1. Ir a https://chrome.google.com/webstore/devconsole
2. Seleccionar el item existente de ProOnboarding (o crear uno nuevo con el mismo ID del manifest si es la primera vez).
3. Click en **Package** (menu lateral izquierdo).
4. Click en **Upload new package**.
5. Seleccionar `proonboarding-0.2.0.zip` y confirmar.
6. La consola valida automaticamente; si pasa, queda en estado "Pending review" (puede tardar desde horas a varios dias).

## Rellenar las secciones (Store listing)

### Pestana "Store listing"

- **Nombre**: `ProOnboarding - Guia interactiva y voz para cualquier web` (copiar de `STORE-LISTING.md`)
- **Descripcion corta**: pegar la de `STORE-LISTING.md` (132 chars max)
- **Descripcion detallada**: pegar la larga (incluye menciones a WebMCP)
- **Categoria**: Productividad
- **Idioma**: Espanol (Latinoamerica) + agregar Ingles (opcional)

### Pestana "Privacy practices"

- **Single purpose**: "Explicar y guiar al usuario en la pagina actual"
- **Permisos usados** (la consola los detecta del manifest): justificar cada uno con las frases de `STORE-LISTING.md` (tabla "Justificacion de permisos")
- **Host permission** (`https://uni-on-boarding-idcs.vercel.app/*`): justificar como backend HTTPS
- **Data usage**: marcar "No recopila datos personales" + los puntos de la seccion "Declaraciones de uso de datos" de `STORE-LISTING.md`
- **Audio**: marcar que se captura en tiempo real solo bajo demanda del usuario
- **Privacy policy URL**: subir `PRIVACY.md` o pegar el texto (GitHub: https://github.com/mauriciop-dev/UniOnBoarding/blob/main/PRIVACY.md)

### Pestana "What's new" (opcional pero recomendado)

- Pegar la seccion "Novedades v0.2.0" de `STORE-LISTING.md`

## Despues de subir

- La consola mostrara "Pending review" - esperar aprobacion.
- El ID del item debe coincidir con el `manifest.json` (campo `key` o el ID que Chrome asigna) para no romper el enlace de feedback que la extension muestra.
- Si ya hay una version publicada: el item pasa a "In review" y luego "Published" automaticamente (Chrome respeta el orden de envio).

## Limitacion importante de WebMCP

WebMCP (`document.modelContext.registerTool`) **solo esta disponible en Chrome Canary/Dev con Origin Trial habilitado** o en Chrome estable cuando Google lo active por defecto. La extension degrada gracefully si no esta disponible (log: "WebMCP no disponible"). Esto NO afecta la aprobacion del Store - la integracion existe en el codigo y se activara cuando Chrome la habilite.

## Verificacion post-publicacion

1. Cargar la extension desde el Store en Chrome Canary.
2. Activar Origin Trial de WebMCP (ver https://developer.chrome.com/origintrials/).
3. Abrir una pagina y el panel de ProOnboarding.
4. En la consola del sidepanel debe aparecer: `[ProOnboarding] WebMCP tools registradas (7)`.
5. Usar Gemini en Chrome (o cualquier agente WebMCP-aware) para invocar `analyzePage`, `startTour`, etc.
