# Politica de Privacidad - ProOnboarding

**Ultima actualizacion:** 28 de junio de 2026

## Que hace esta extension

ProOnboarding analiza la pagina web activa para generar resumenes y recorridos interactivos guiados por audio. La extension se activa **unicamente cuando el usuario presiona el boton "Esta pagina"** en el panel lateral.

## Que informacion recopila y procesa

| Informacion | Uso |
|---|---|
| **DOM de la pagina activa** (HTML limpio, sin scripts, sin estilos, sin iframes, sin contenido embebido) | Se envia al backend en Vercel para que la IA genere un resumen y un recorrido paso a paso. Solo cuando el usuario lo solicita. |
| **URL de la pagina** | Se envia junto con el DOM para contexto del analisis. |
| **Idioma seleccionado** (es, en, pt, fr) | Se usa para generar el contenido en el idioma elegido. Se almacena localmente en `chrome.storage.local`. |
| **URL personalizada del API** | Se almacena localmente en `chrome.storage.local`. |

## Que NO recopila

- No recopila informacion personal identificable (nombres, correos, credenciales).
- No recopila cookies, tokens de sesion, ni datos de autenticacion.
- No recopila historial de navegacion.
- No recopila datos de teclado ni interacciones del usuario fuera de los clics en los elementos del recorrido.
- No envia analiticas ni datos de uso a terceros.
- No usa rastreadores ni beacons.
- No vende ni comparte datos con terceros.

## Almacenamiento local

La extension usa `chrome.storage.local` unicamente para:
- Recordar la URL del API que configures.
- Recordar el idioma seleccionado.

Estos datos nunca salen de tu navegador.

## Comunicacion con el servidor

La extension se comunica exclusivamente con el endpoint del backend que el usuario configure (por defecto `https://uni-on-boarding-idcs.vercel.app/api/analyze-page`). La comunicacion es HTTPS. No se envian datos a ningun otro servidor.

## Datos embebidos en las paginas analizadas

Si la pagina que analizas contiene datos personales visibles en el DOM (ej. tu nombre en un dashboard), esos datos viajan al backend junto con el resto del HTML para el analisis. No almacenamos ni registramos esos datos de forma persistente. Si te preocupa la privacidad, evita analizar paginas que contengan informacion sensible.

## Cambios a esta politica

Si esta politica cambia, se actualizara la fecha de "Ultima actualizacion" y se reflejaran los cambios en el repositorio.

## Contacto

Creado por Mauricio P. Reporta issues en:
https://github.com/mauriciop-dev/UniOnBoarding/issues
