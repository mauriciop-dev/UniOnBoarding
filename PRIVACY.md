# Politica de Privacidad - ProOnboarding

**Ultima actualizacion:** 12 de agosto de 2026

## Que hace esta extension

ProOnboarding analiza la pagina web activa para generar resumenes y recorridos interactivos guiados por audio. La extension se activa **unicamente cuando el usuario lo solicita**:

- Pulsando **"Esta pagina"** → analiza el DOM y arma un resumen + recorrido paso a paso.
- Pulsando **"Iniciar recorrido"** → resalta los elementos y narra cada paso (TTS cloud con fallback a voz local).
- Pulsando **"Hablar"** (Modo Voz) → abre una conversacion de voz en tiempo real con el asistente.
- Usando el **chat** → conversacion por texto con contexto de la pagina.

## Que informacion recopila y procesa

| Informacion | Uso |
|---|---|
| **DOM de la pagina activa** (HTML limpio, sin scripts, sin estilos, sin iframes, sin contenido embebido) | Se envia al backend en Vercel para que la IA genere el resumen y el recorrido paso a paso. Solo cuando el usuario lo solicita. |
| **URL de la pagina** | Se envia junto con el DOM para contexto del analisis. |
| **Texto de chat** (lo que escribes en el chat) | Se envia al backend de ProOnboarding (`/api/chat`) para generar la respuesta con el contexto de la pagina. |
| **Texto de los pasos** | Se envia al servicio de voz cloud (Deepgram, `/api/tts`) solo para sintetizar el audio. Si el servicio cloud no esta disponible, la narracion usa las voces locales del navegador (Web Speech API) y no sale del dispositivo. |
| **Audio del microfono (Modo Voz)** | Capturado **solo mientras mantienes presionado "Hablar"**: se envia en tiempo real como audio PCM16 (16 kHz, trozos de 20 ms) directamente al proveedor de voz elegido (Google Gemini Live o Deepgram Agent) via WebSocket, usando un token efimero emitido por tu backend. El audio **no pasa por el backend de ProOnboarding** y no se guarda. Se interrumpe al soltar el boton o cerrar el Modo Voz. |
| **Valoracion y comentario opcional (feedback)** | Si el usuario lo envia: estrellas + comentario opcional a `/api/feedback`. Visible a los desarrolladores en el panel de datos. |
| **Idioma seleccionado** (es, en, pt, fr) | Se usa para generar el contenido en el idioma elegido. Se almacena localmente en `chrome.storage.local`. |
| **URL personalizada del API** (opcional) | Se almacena localmente en `chrome.storage.local`. |
| **Claves de desarrollo (Gemini/Deepgram, opcionales)** | Campos de Configuracion reservados como **fallback de desarrollo** cuando tu API no emite un token. Se guardan solo en `chrome.storage.local` y **nunca se envian al backend de ProOnboarding**. En produccion no se usan: el Modo Voz funciona con el token efimero del servidor. |

## Que NO recopila

- No recopila informacion personal identificable (nombres, correos, credenciales).
- No recopila cookies, tokens de sesion ni datos de autenticacion.
- No recopila historial de navegacion.
- No recopila datos de teclado ni interacciones del usuario fuera de los clics en los elementos del recorrido.
- No envia analiticas ni datos de uso a terceros.
- No usa rastreadores ni beacons.
- No vende ni comparte datos con terceros.
- No graba audio de forma continua ni en segundo plano: el microfono solo se activa durante el Modo Voz, bajo demanda explicita del usuario.

## Almacenamiento local

La extension usa `chrome.storage.local` unicamente para:
- Recordar la URL del API que configures.
- Recordar el idioma, el avatar del asistente y el proveedor de voz elegido.
- Guardar las claves de desarrollo opcionales (solo fallback local) si el usuario las ingresa.
- Cachear resultados de analisis recientes (para no re-analizar paginas repetidas).

Estos datos nunca salen de tu navegador.

## Comunicacion con el servidor

- **Analisis / chat / feedback / token de voz**: HTTPS al endpoint del backend que el usuario configure (por defecto `https://uni-on-boarding-idcs.vercel.app`).
- **Modo Voz (audio)**: WebSocket directo a **Google Gemini Live** (`wss://generativelanguage.googleapis.com`) o **Deepgram Agent** (`wss://agent.deepgram.com`), autenticado con un token efimero mintedo por tu backend. Tu backend solo emite el token: **no recibe ni almacena el audio**.
- **TTS cloud**: el texto del paso va a Deepgram via `/api/tts` para sintetizar el audio; con fallback a voces locales (sin salir del dispositivo).
- **Servidor local de voz (Voicebox, opcional)**: solo si el usuario configura una URL base local en los Ajustes; se usa como fallback adicional para la narracion.

## Datos embebidos en las paginas analizadas

Si la pagina que analizas contiene datos personales visibles en el DOM (ej. tu nombre en un dashboard), esos datos viajan al backend junto con el resto del HTML para el analisis. No almacenamos ni registramos esos datos de forma persistente mas alla del cache. Si te preocupa la privacidad, evita analizar paginas que contengan informacion sensible.

## Cambios a esta politica

Si esta politica cambia, se actualizara la fecha de "Ultima actualizacion" y se reflejaran los cambios en el repositorio.

## Contacto

Creado por Mauricio P. Reporta issues en:
https://github.com/mauriciop-dev/UniOnBoarding/issues