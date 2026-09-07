# Subir ProOnboarding v0.2.0 a la Chrome Web Store

> Checklist paso a paso para publicar la version 0.2.0 con integracion WebMCP.

## Archivos listos

- **`proonboarding-0.2.0.zip`** (47 KB, 19 entradas) - el paquete a subir
- **`STORE-LISTING.md`** - textos para nombre, descripcion, justificaciones
- **`PRIVACY.md`** - politica de privacidad

## Verificacion del paquete antes de subir

Antes de ir a la consola del Store, valida el zip localmente:

```bash
node scripts/verify-store-package.mjs
```

Verifica 10 cosas: zip existe y < 2 GB, ZIP valido (EOCD + central directory), 19/19 archivos esperados, sin extras, ningun archivo > 50 MB, version del manifest coincide con el nombre del zip, manifest con campos obligatorios, permisos del manifest correctos para 0.2.0, host permissions presentes.

Si pasa, muestra: `[OK] Paquete listo para subir a la Chrome Web Store.`

## Cambio de permisos vs 0.1.4 publicado

| Permiso | 0.1.4 publicado | 0.2.0 borrador | Razon |
|---|---|---|---|
| `sidePanel` | ✅ | ✅ | Panel lateral |
| `activeTab` | ✅ | ✅ | DOM bajo demanda |
| `scripting` | ✅ | ✅ | Inyecta overlay |
| `storage` | ✅ | ✅ | Config + cache local |
| **`offscreen`** | ❌ | ✅ | **NUEVO en 0.2.0**: captura de microfono para el Modo Voz confirmado en v0.1.27 |
| host permission | ✅ | ✅ | Backend Vercel |

**Implicacion**: Chrome hara una re-revision completa (no un update rapido) porque se agrego un permiso nuevo. La justificacion de `offscreen` esta en la seccion "Justificacion de permisos" de `STORE-LISTING.md`.

## Pasos en la consola de Chrome Web Store

1. Ir a https://chrome.google.com/webstore/devconsole
2. Seleccionar el item existente de ProOnboarding (o crear uno nuevo con el mismo ID del manifest si es la primera vez).
3. Click en **Package** (menu lateral izquierdo).
4. Click en **Upload new package**.
5. Seleccionar `proonboarding-0.2.0.zip` y confirmar.
6. La consola valida automaticamente; si pasa, queda en estado "Pending review" (puede tardar desde horas a varios dias por la re-revision del permiso nuevo).

## Rellenar las secciones (Store listing)

### Pestana "Store listing"

- **Nombre**: `ProOnboarding - Guia interactiva y voz para cualquier web` (copiar de `STORE-LISTING.md`)
- **Descripcion corta**: pegar la de `STORE-LISTING.md` (132 chars max)
- **Descripcion detallada**: pegar la larga (incluye menciones a WebMCP)
- **Categoria**: Productividad
- **Idioma**: Espanol (Latinoamerica) + agregar Ingles (opcional)

### Pestana "Privacy practices"

- **Single purpose**: "Explicar y guiar al usuario en la pagina actual"
- **Permisos usados** (la consola los detecta del manifest): justificar cada uno con las frases de `STORE-LISTING.md` (tabla "Justificacion de permisos"). Prestar especial atencion a `offscreen` (NUEVO).
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
