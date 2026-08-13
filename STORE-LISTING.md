# Chrome Web Store — Textos y declaraciones para el listing

> **Antes de subir**: en la consola del Store, crea el item con el **mismo ID** que
> el manifest si ya tenes un item publicado (para no romper el enlace "Calificar en
> Chrome Web Store" que usa la extension). La version empaquetada sale de
> `node scripts/package-store.mjs` → `proonboarding-<version>.zip`.

---

## Nombre

`ProOnboarding - Guia interactiva y voz para cualquier web`

(16 caracteres minimo / 75 maximo para el nombre.)

## Titulo corto / Slug sugerido

`ProOnboarding`

## Descripcion corta (<= 132 caracteres)

```
Explica cualquier pagina y te guia paso a paso: resumen, recorrido interactivo con audio y chat por voz.
```

## Descripcion larga

```
ProOnboarding convierte cualquier pagina web en una visita guiada. Abre el panel, toca "Esta pagina" y obten:

• RESUMEN: una explicacion clara de que hace la pagina y como usarla.
• RECORRIDO INTERACTIVO: pasos numerados que resaltan cada elemento de la interfaz mientras un narrador (TTS) te guia. Avisa si necesitas ayuda y continua exactamente donde quedaste.
• AUDIO EN TODO MOMENTO: narracion de cada paso con voz de alta calidad en la nube y fallback a voces locales sin conexion.
• CHAT: preguntale al asistente sobre la pagina con contexto incluido (funciona por texto o por voz en tiempo real).
• MODO VOZ EN TIEMPO REAL: mantene presionado "Hablar" y conversa con el asistente de voz; sus respuestas se escuchan al instante.
• MULTI-IDIOMA: es, en, pt, fr.

Es ideal para: soporte tecnico, productos SaaS, tutoriales rapidos, accesibilidad y onboarding de usuarios en tu propia web.

Privacidad: la extension se activa solo cuando la usas. El analisis de la pagina, el chat y la voz se procesan contra el backend que configures (por defecto HTTPS). El audio del microfono se envia en tiempo real solo mientras mantenes presionado "Hablar" y no se almacena. No hay rastreadores, analytics ni venta de datos.
```

## Categoria sugerida

**Productividad** (alternativa: *Accesibilidad* por la asistencia guiada con audio).

## Promocion (opcional, en la consola)

- Tarjeta principal: captura del recorrido con un elemento resaltado en morado.
- Capturas 1280x800: (1) panel con resumen, (2) recorrido con resaltado + etiqueta, (3) chat de voz con barra "Hablar".
- Logo: icono actual (P morada) o uno propio en `extension/icons/`.

---

## Justificacion de permisos (seccion "Declaraciones de privacidad")

El formulario pide explicar cada permiso. Usa estas frases:

| Permiso | Justificacion |
|---|---|
| `sidePanel` | Muestra el panel de ProOnboarding en el panel lateral de Chrome. |
| `activeTab` | Accede al DOM de la pestaña actual **solo cuando el usuario pulsa "Esta pagina"** para generar el resumen y el recorrido. |
| `scripting` | Inyecta el resaltado visual (overlay) y las etiquetas de cada paso del recorrido cuando el usuario lo inicia. |
| `storage` | Guarda ajustes locales (idioma, URL del API, avatar, proveedor de voz) y cache de analisis en `chrome.storage.local`. Nunca sale del navegador. |
| `offscreen` | Captura el microfono para el Modo Voz en un documento offscreen (requisito de Chrome: el side panel no puede mostrar el prompt de `getUserMedia`). Solo bajo demanda del usuario. |
| Host `https://uni-on-boarding-idcs.vercel.app/*` | Backend HTTPS que genera el resumen, el recorrido, el chat y el token efimero de voz. No se llama a ningun otro origen de la extension. |

## Declaraciones de uso de datos (opcional, recomendado)

- **Uso unico**: Esta extension tiene un unico proposito: explicar y guiar al usuario en la pagina actual.
- **Datos que usas (si es aplicable)** — la Store pregunta por cada uno:
  - *Datos personales*: No recopilados.
  - *Actividad en paginas*: Solo el DOM + URL de la pagina actual, bajo demanda explicita del usuario, para generar la guia.
  - *Audio*: Se captura en tiempo real **solo mientras el usuario mantiene presionado "Hablar"** y se envia directamente al proveedor de voz (Google/Deepgram); no se almacena.
  - *Datos de usuario*: Sin cuentas, sin auth, sin sincronizacion.
- **Ventas/uso para publicidad**: No. **Transferencia a terceros**: No (el audio va al proveedor de voz solicitado; el texto del TTS a Deepgram; nada se vende).
- **Eliminacion**: los datos estan en el dispositivo (`chrome.storage.local`) y se borran con la extension. Los feedbacks enviados por el usuario se guardan en el panel del desarrollador.

## URL de soporte / detalles

- Pagina de soporte: `https://github.com/mauriciop-dev/UniOnBoarding/issues`
- Politica de privacidad: `PRIVACY.md` (subir el archivo o pegar el texto en la consola).
- Sitio: `https://github.com/mauriciop-dev/UniOnBoarding`
