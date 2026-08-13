# Playbook: Gemini Live API en una extensión Chrome — lo que aprendimos en ProOnboarding

> Documento de transferencia de conocimiento. Objetivo: que otra IA o un nuevo
> proyecto apliquen **sin repetir los errores** toda la experiencia de integrar
> Gemini Live (BidiGenerateContent) en una extensión MV3 con microfono y audio
> real, diagnostico por consola incluido.
>
> Referencias: repositorio `mauriciop-dev/UniOnBoarding`, changelog
> `CHANGELOG-EXTENSION.md` (versiones 0.1.10 a 0.1.28).

---

## 0. Resumen en una frase

El audio del microfono es el tramo facil de romper, pero la causa real de "no
te escucha" y "no se oye" casi nunca esta en Gemini: esta en **tres fosiles de
Chromium** (mensajes binarios por `chrome.runtime`, restriccion de autoplay del
AudioContext y el flakiness del AudioWorklet como salida) y en **un schema de
WebSocket facil de equivocar**.

---

## 1. Arquitectura final del Modo Voz (referencia)

```
[request-mic.html]  concede getUserMedia (pagina visible; el sidepanel NO puede)
        │
[offscreen document  (razon USER_MEDIA)]  captura el mic
        │  AudioWorkletNode('proob-mic-capture') → PCM16 16 kHz, chunks de 20 ms (320 samples)
        │  node.connect(ctx.destination)  ← OBLIGATORIO o el worklet nunca procesa
        ▼
  chrome.runtime.sendMessage(proob:pcm, base64)   ← SIEMPRE base64, jamas ArrayBuffer
        ▼
[sidepanel]  b64ToBytes → provider.sendAudio() → WS a Gemini
        │  realtimeInput: { audio: { data: <base64>, mimeType: 'audio/pcm;rate=16000' } }
        ▼
[Gemini Live]  serverContent.modelTurn.parts[].inlineData (PCM 24 kHz, base64, mime audio/pcm;rate=24000)
        ▼
[sidepanel]  _playBuffer(): AudioBufferSourceNode encadenados (NO AudioWorklet)
```

Autenticacion en produccion: la extension **nunca tiene la key**. Pide un token
efimero a tu backend (`POST /api/voice-token`) que mintea
`BidiGenerateContentConstrained?access_token=...`. En dev se usa `?key=`.

---

## 2. Bitacora paso a paso: problemas, diagnostico en consola y solucion

### 0.1.10→0.1.13 — El setup del WebSocket esta mal (schema)

| Sintoma | Diagnostico (consola) | Causa raiz | Fix |
|---|---|---|---|
| El WS se cierra o no llega `setupComplete` | Respuesta de error del WS menciona `Unknown name "responseModalities" at 'setup'` | `responseModalities` NO va directo en `setup` | Va dentro de **`setup.generationConfig.responseModalities: ["AUDIO"]`** junto a `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` |
| `auth_tokens` REST rechaza el pedido | `Unknown name at 'auth_token'` / `Unknown field liveConnectConstraints` | El SDK de Google mapea `liveConnectConstraints` aparte | Por REST al mint solo se envian `uses` (o `expireTime`); el constraint va al conectar |
| El backend no mintea | Error `constraints` en el POST | Se mandaba el payload equivocado | Fix arriba; endpoint final: `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` con header `x-goog-api-key` |
| Modo voz configurado con TEXT+audio | Error de modalidad | `gemini-3.1-flash-live-preview` **solo acepta AUDIO** | Fijar `responseModalities:["AUDIO"]`, no pedir texto |

**Leccion:** el schema de Gemini Live cambia seguido y el SDK lo mapea distinto
que la API REST. Valida **siempre** contra el WS real con la key de dev, con un
mini harness de Node, antes de tocar la UI.

### 0.1.17 — "Conectando..." para siempre (messages como Blob)

| Sintoma | Diagnostico | Causa raiz | Fix |
|---|---|---|---|
| El panel queda "<conectando>" eterno, sin errores | Sin logs: `JSON.parse(ev.data)` fallaba **en silencio** | Gemini Live entrega los mensajes JSON del WS como **Blob/binario** (no siempre string) | Aceptar string **y** Blob en el handler: `messageText(ev)` / `await data.text()`; mantener parseo sincrono para strings |
| (seguridad) | — | — | **Watchdog**: si en 20 s no llega `setupComplete`, cerras la sesion y mostras "Sin respuesta del servidor (timeout tras 20s)" en vez de colgarse |

**Leccion:** nunca hagas `JSON.parse(ev.data)` directo. Y todo estado de conexion
debe tener timeout visible al usuario.

### 0.1.18 — "Escucha pero nunca responde": el worklet de microfono no procesaba

| Sintoma | Diagnostico | Causa raiz | Fix |
|---|---|---|---|
| La sesion conecta, Gemini no responde a la voz | Logs: `PCM del microfono llegando al offscreen` **nunca aparecia** | **Regla de Web Audio:** un `AudioWorkletNode` NO ejecuta `process()` si no esta conectado a `destination` (no participa del grafo de render) | Microfono: `src.connect(node); node.connect(ctx.destination);` (emite silencio, no eco). Lo mismo en la ruta inline |
| Contexto suspendido | `AudioContext estado: suspended` | Autoplay policy de Chromium | `ctx.resume()` al crear y en `onstatechange` |

**Leccion:** todo nodo WebAudio que deba "correr" necesita estar conectado a
`destination` o a otro nodo activo. Es la causa #1 de worklets "mudos".

### 0.1.22→0.1.23 — "No te escucha": ArrayBuffer corrompido en chrome.runtime

| Sintoma | Diagnostico (consola) | Causa raiz | Fix |
|---|---|---|---|
| Gemini nunca responde, aunque el mic captura | - `nivel microfono crudo (offscreen): 61.7%` (Analyser sobre la stream)<br>- `chunk con peak 13775 al salir del offscreen`<br>- **`chunk aqui: 0` en el sidepanel** | `chrome.runtime.sendMessage` con payload `ArrayBuffer` (offscreen→sidepanel) entrega el buffer **neutralizado/corrompido a ceros** | Enviar el PCM como **string base64** (clonado binario garantizado) y decodificar en destino antes de mandarlo a Gemini |
| Confirmacion | Ambos peaks coinciden >0 | — | Comparar `peak recomputado (sidepanel)` vs `msg.peak (offscreen)`: deben ser iguales y >0 |

**Leccion:** en MV3, el binario que cruza contextos por `chrome.runtime` va como
**base64**, no como ArrayBuffer/TypedArray. Es la causa #2 de "audio que se
pierde en el camino".

### 0.1.24→0.1.27 — "Gemini responde pero no se oye": el sink de salida

| Sintoma | Diagnostico (consola) | Causa raiz | Fix |
|---|---|---|---|
| `Gemini envio serverContent:` si, el audio llega, pero no suena | - `AudioContext (reproduccion) estado: running`<br>- sink recibe el PCM (`cola 515042` creciendo)<br>- **`process()` nunca se ejecuta** → la cola no drena al parlante | **Regla de Chromium:** un `AudioWorkletNode` de salida sin **ninguna entrada conectada** no recibe `process()` (esta "inactivo") | Intentos fallidos: `numberOfInputs:0`, keep-alive (oscilador 1Hz→gain 0) → apenas mejoro |
| Sigue sin drenar | Con keep-alive `process() ACTIVO` aparece, pero la cola **crece/fluctua** (hasta 792572 samples) | El worklet de salida es **poco confiable como tuberia** en Chromium | **Abandono del worklet como sink.** Reproducir con **`AudioBufferSourceNode` encadenados** (API clasica, la misma que usa el TTS del tour): cada frame PCM16 24 kHz se remuestrea por interpolacion lineal al rate del contexto y se programa con `src.start(at)` sin huecos contra `currentTime` acumulado |
| Confirmacion | `play: programado buffer N samples (S s )` | — | Se oye la respuesta de Gemini |

**Leccion doble:** (a) para **salida** de audio usa `AudioBufferSourceNode`
(garantizado por el motor), no AudioWorklet; (b) la causa #3 del "no se oye"
es el worklet de salida inactivo por falta de entrada.

### 0.1.28 — "envios fallidos" y limpieza final

| Sintoma | Diagnostico | Causa raiz | Fix |
|---|---|---|---|
| `envios fallidos: 17` clavado en un numero | Todos ocurrieron en el arranque; despues 0 | `sendAudio` devolvia `false` mientras el WS estaba `CONNECTING` (readyState != 1) y esos chunks se perdian | **Buffer de arranque:** guardar hasta 100 chunks mientras el WS conecta y volcarlos en orden en el primer envio con WS abierto |
| Consola ruidosa | Cientos de logs por sesion | Logs de diagnostico cada 200 chunks / 500 ms | Conservar solo 1 log por tipo (AudioContext estado, serverContent, primer buffer programado) + alertas reales (chunks diferidos) |

---

## 3. Recetas de diagnostico por consola (lo que funciono)

1. **Mide amplitud en cada salto del audio**, no solo "llego/no llego":
   - AnalyserNode sobre la stream del mic (nivel %).
   - Peak pico de samples Int16 por chunk (`max(|s|)`), con escala: 0 = silencio, ~10–20k = voz real.
   - Log en origen y log re-computado en destino: **si los numeros no coinciden, esta "muriendo" en ese tramo**.
2. **Instrumenta el grafo en 3 puntos** para localizar el cero: raw del mic → chunk del worklet → chunk en destino.
3. **Medidor visual en la pagina de permiso** (`request-mic.html`): si la barra sube ahi, el problema es el transporte, no el microfono.
4. **Loguea estado del AudioContext** (`suspended/running`) y reintenta `resume()` en `onstatechange`.
5. **Marca con flags de "una vez"** (`_logged`, `_scLogged`) para no inundar la consola y dejar los logs utiles siempre prendidos.
6. En el worklet, distingue causas con un log del tipo `sink: pcm16 #N samples M rate R | cola L` — te separa "contexto suspendido" de "datos rotos" de "cola parada".
7. Compara **`chunk aqui (sidepanel) == chunk al salir del offscreen`** como test de integridad punta a punta.

---

## 4. Recomendaciones para un NUEVO proyecto (checklist)

### Arquitectura y seguridad
- [ ] **Nunca embarques una API key en la extension.** Token efimero minteado por tu backend desde el dia uno (browser → backend HTTPS → `auth_tokens`/`auth/grant` → WS `?access_token=`).
- [ ] Backend: mint `POST .../v1beta/auth_tokens` con `x-goog-api-key` y `uses`/`expireTime`. Nada de constraints en el mint.
- [ ] Claves locales SOLO como fallback de desarrollo, en `chrome.storage.local`, nunca enviadas al backend.
- [ ] Host permission de la extension solo a tu API; los WebSockets de voz no necesitan host_permissions.

### Protocolo WS (Gemini Live)
- [ ] Mensajes JSON del WS como string **o** Blob (`await data.text()`). Nunca `JSON.parse(ev.data)` directo.
- [ ] `responseModalities` dentro de **`generationConfig`** (con `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`). No en `setup` raiz.
- [ ] Entrada: `realtimeInput: { audio: { data: <b64>, mimeType: 'audio/pcm;rate=16000' } }` (16 kHz). PREFERIDO a `mediaChunks`.
- [ ] Salida: `serverContent.modelTurn.parts[].inlineData` → PCM 24 kHz base64; parsear `rate` del mimeType (`audio/pcm;rate=24000`).
- [ ] `inputAudioTranscription` puede ser rechazado por el schema (`1007 Unknown name`) — no lo des por sentado; valida version.
- [ ] `gemini-3.1-flash-live-preview` es AUDIO-only. No piDAS modalidad TEXT.
- [ ] Transcribe con servidor si necesitas texto (o usa `outputTranscription` cuando exista).
- [ ] Watchdog de 20 s para `setupComplete` + timeout visible al usuario.

### Microfono y WebAudio (MV3)
- [ ] En sidepanel/popup NO funciona el prompt de `getUserMedia` (bug de Chromium). Usa **offscreen document** con razon `USER_MEDIA` + pagina visible (`request-mic.html`) para conceder el permiso la primera vez.
- [ ] Worklet de captura VS **debe** conectar a `destination` o no procesa.
- [ ] Binario entre contextos: **base64** por `chrome.runtime.sendMessage`.
- [ ] `ctx.resume()` al crear y en `onstatechange`.
- [ ] **Salida de audio: `AudioBufferSourceNode` encadenados**, no AudioWorklet (ver 0.1.27). Bufferiza el PCM, remuestrea con interpolacion lineal al rate del contexto y programa sin huecos.
- [ ] Buffer de arranque: retener chunks mientras el WS conecta (evita perder el inicio de la conversacion).

### Calidad
- [ ] Harness con WebSocket mock para el flujo JSON, **y** un harness real de red (Node) con la key de dev para validar schema + handshake contra Google.
- [ ] Limpia tracks/streams/nodos/WS en `stop()` y en `onclose`; reporta `code/reason` del cierre.
- [ ] Logs de diagnostico con flags de una sola vez; mantenelos para soporte en campo.
- [ ] Presupuesto de costos visible: Gemini Live `gemini-3.1-flash-live-preview` ≈ $0.012–0.023/min de conversacion (mas barato que full-stack Agent).

### Errores tipicos que evitar (resumen de causa raiz)
1. AudioWorklet de **microfono** sin conectar a destination → captura muda.
2. **ArrayBuffer** atravesando `chrome.runtime.sendMessage` → corrompido a ceros.
3. AudioWorklet de **salida** sin entrada / como tuberia → no suena.
4. `JSON.parse` directo sobre Blob → setup que nunca completa.
5. `responseModalities` fuera de `generationConfig` → schema rechazado.
6. Modelo en modalidad TEXT cuando solo soporta AUDIO → error de sesion.
7. Enviar keys/constraints en el mint REST → rechazo.

---

## 5. Costo y seleccion de proveedor (nota para escenarios reales)

| Opcion | Costo aprox. | Estado |
|---|---|---|
| Gemini Live (`gemini-3.1-flash-live-preview`, token efimero) | ~$0.012–0.023/min | Recomendada; validada de punta a punta |
| Deepgram Agent (full-stack STT+LLM+TTS) | ~$0.068–0.11/min | Requiere key con addon Agent (`auth/grant` 403 con key standard) |

En esta integracion Deepgram quedo como proveedor alternativo; la ruta de
produccion principal es Gemini Live con token efimero.

---

*Fin del playbook. Creado a partir del desarrollo real (v0.1.10→v0.1.28) de
ProOnboarding. Repo: https://github.com/mauriciop-dev/UniOnBoarding*