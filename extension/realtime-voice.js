// realtime-voice.js — Modo Voz de ProOnboarding.
//
// Sesion de voz bidireccional (hablar y escuchar) con dos proveedores:
//   L1 gemini_live    : Gemini Live API directo (WebSocket BidiGenerateContent,
//                       ~key= en la URL, mensajes JSON setup/realtimeInput/serverContent).
//   A  deepgram_agent : Deepgram Agent API (WebSocket wss://agent.deepgram.com/v1/agent/converse,
//                       auth por Sec-WebSocket-Protocol ['token', KEY], Settings JSON
//                       primero; combina STT + LLM + TTS en una sola sesion).
//                       El "think" usa Google Gemini: si se pasa `geminiKey`, Deepgram
//                       llama a Google con TU key (BYO, `think.endpoint.headers["x-goog-api-key"]`);
//                       sin key usa el LLM de Google gestionado por Deepgram (facturado por Deepgram).
//
// El audio del microfono se captura en un AudioWorklet (PCM16 16 kHz) y el audio de
// respuesta se reproduce por otro worklet (colas PCM16 -> contexto de audio).

export const REALTIME_PROVIDERS = Object.freeze({
  GEMINI_LIVE: 'gemini_live',
  DEEPGRAM_AGENT: 'deepgram_agent'
});

export const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
export const GEMINI_DEFAULT_VOICE = 'Kore';
const GEMINI_WSS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_WSS_CONSTRAINED = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
export const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';
export const DEEPGRAM_AGENT_OUTPUT_RATE = 24000;
const DEEPGRAM_GOOGLE_LLM = 'https://generativelanguage.googleapis.com/v1beta/models/{{model}}:streamGenerateContent?alt=sse';

function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getWsImpl(wsImpl) {
  if (wsImpl) return wsImpl;
  return typeof WebSocket !== 'undefined' ? WebSocket : null;
}

async function messageText(ev) {
  const d = ev && ev.data;
  if (typeof d === 'string') return d;
  if (d == null) return null;
  if (typeof d.text === 'function') return d.text();
  try {
    if (ArrayBuffer.isView(d)) return new TextDecoder().decode(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
    if (d instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(d));
  } catch { return null; }
  return null;
}

// ---------------------------------------------------------------------------
// Gemini Live (BidiGenerateContent)
// ---------------------------------------------------------------------------

export class GeminiLiveProvider {
  constructor({ apiKey = '', accessToken = '', model = GEMINI_DEFAULT_MODEL, voice = GEMINI_DEFAULT_VOICE, language = 'es', prompt = '', wsUrl = null, wsImpl = null,
    onUserText = null, onAssistantText = null, onTurnComplete = null, onStatus = null, onAudio = null, onError = null, onClose = null }) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
    this.model = model;
    this.voice = voice;
    this.language = language;
    this.prompt = prompt;
    this.wsUrl = wsUrl;
    this.wsImpl = wsImpl;
    this.onUserText = onUserText;
    this.onAssistantText = onAssistantText;
    this.onTurnComplete = onTurnComplete;
    this.onStatus = onStatus;
    this.onAudio = onAudio;
    this.onError = onError;
    this.onClose = onClose;
    this.ws = null;
  }

  connect() {
    const WS = getWsImpl(this.wsImpl);
    if (!WS) { this.onError?.(new Error('WebSocket no disponible')); return; }
    // Token efimero (produccion) -> endpoint Constrained con access_token;
    // API key directa (desarrollo) -> ?key=.
    const url = this.wsUrl || (this.accessToken
      ? `${GEMINI_WSS_CONSTRAINED}?access_token=${encodeURIComponent(this.accessToken)}`
      : `${GEMINI_WSS_BASE}?key=${encodeURIComponent(this.apiKey)}`);
    const ws = new WS(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${this.model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } },
              languageCode: this.language
            }
          },
          systemInstruction: { parts: [{ text: this.prompt || 'Eres un asistente de voz util y conciso.' }] }
        }
      }));
      this.onStatus?.('conectando');
    };
    ws.onmessage = (ev) => this._onSocketMessage(ev);
    ws.onerror = () => this.onError?.(new Error('Error de WebSocket Gemini Live'));
    ws.onclose = (e) => this.onClose?.({ code: e && e.code, reason: (e && e.reason) || '' });
  }

  _onJsonMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.setupComplete) { this.onStatus?.('listo'); return; }
    if (msg.serverContent) {
      const sc = msg.serverContent;
      if (sc.interrupted) { this.onStatus?.('interrumpido'); this.onTurnComplete?.('interrupted'); }
      if (sc.inputTranscription && sc.inputTranscription.text) {
        this.onUserText?.(sc.inputTranscription.text, false);
      }
      if (sc.outputTranscription && sc.outputTranscription.text) {
        this.onAssistantText?.(sc.outputTranscription.text, false);
      }
      for (const part of (sc.modelTurn && sc.modelTurn.parts) || []) {
        if (part.inlineData && part.inlineData.data) {
          const bytes = b64ToBytes(part.inlineData.data);
          const mime = String(part.inlineData.mimeType || '');
          const rateMatch = /rate=(\d+)/.exec(mime);
          this.onAudio?.({ pcm16: bytes.buffer, rate: rateMatch ? Number(rateMatch[1]) : 24000 });
        }
      }
      if (sc.turnComplete) { this.onTurnComplete?.(); this.onStatus?.('listo'); }
      return;
    }
    if (msg.toolCall) this.onStatus?.('usando herramienta');
  }

  async _onSocketMessage(ev) {
    const d = ev && ev.data;
    if (typeof d === 'string') { this._onJsonMessage(d); return; }
    const text = await messageText(ev);
    if (text) this._onJsonMessage(text);
  }

  sendAudio(pcm16Bytes) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({
      realtimeInput: { audio: { data: bytesToB64(pcm16Bytes), mimeType: 'audio/pcm;rate=16000' } }
    }));
    return true;
  }

  close() { try { if (this.ws) this.ws.close(); } catch { this.ws = null; } }
}

// ---------------------------------------------------------------------------
// Deepgram Agent API
// ---------------------------------------------------------------------------

function isPlainObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override || {})) {
    const v = override[k];
    if (isPlainObj(v) && isPlainObj(base?.[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

export function defaultAgentSettings({ language = 'es', prompt = '', voice = 'aura-2-selena-es', thinkModel = 'gemini-3.1-flash-lite', geminiKey = '' } = {}) {
  const think = {
    provider: { type: 'google', version: 'ai-studio-v1beta', model: thinkModel, temperature: 0.5 },
    prompt: prompt || 'Eres el asistente de voz de ProOnboarding. Responde breve y claro, en voz.'
  };
  if (geminiKey) {
    // BYO: Deepgram llama a Google con TU key. Con endpoint propio el campo provider.model
    // NO se usa; el modelo va en la URL del endpoint.
    think.provider = { type: 'google', version: 'ai-studio-v1beta', temperature: 0.5 };
    think.endpoint = {
      url: DEEPGRAM_GOOGLE_LLM.replace('{{model}}', thinkModel),
      headers: { 'x-goog-api-key': geminiKey }
    };
  }
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: DEEPGRAM_AGENT_OUTPUT_RATE, container: 'none' }
    },
    agent: {
      language,
      speak: { provider: { type: 'deepgram', model: voice } },
      listen: { provider: { type: 'deepgram', model: 'nova-3' } },
      think,
      greeting: 'Hola, soy tu guia de ProOnboarding. En que te ayudo?'
    }
  };
}

export class DeepgramAgentProvider {
  constructor({ apiKey = '', accessToken = '', settings = null, url = DEEPGRAM_AGENT_URL, thinkModel = 'gemini-3.1-flash-lite', language = 'es', prompt = '', geminiKey = '', wsImpl = null,
    onUserText = null, onAssistantText = null, onTurnComplete = null, onInterrupt = null, onStatus = null, onAudio = null, onError = null, onClose = null }) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
    const base = defaultAgentSettings({ language, prompt, thinkModel, geminiKey });
    this.settings = settings ? deepMerge(base, settings) : base;
    this.url = url;
    this.wsImpl = wsImpl;
    this.onUserText = onUserText;
    this.onAssistantText = onAssistantText;
    this.onTurnComplete = onTurnComplete;
    this.onInterrupt = onInterrupt;
    this.onStatus = onStatus;
    this.onAudio = onAudio;
    this.onError = onError;
    this.onClose = onClose;
    this.outputRate = (this.settings.audio && this.settings.audio.output && this.settings.audio.output.sample_rate) || DEEPGRAM_AGENT_OUTPUT_RATE;
    this.ws = null;
  }

  connect() {
    const WS = getWsImpl(this.wsImpl);
    if (!WS) { this.onError?.(new Error('WebSocket no disponible')); return; }
    // En navegador solo se permite Sec-WebSocket-Protocol: token + key.
    // Con token efimero del backend se usa igual (el token va por el protocol).
    const ws = new WS(this.url, ['token', this.accessToken || this.apiKey]);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.settings));
      this.onStatus?.('configurando');
    };
    ws.onmessage = (ev) => this._onSocketMessage(ev);
    ws.onerror = () => this.onError?.(new Error('Error de WebSocket Deepgram Agent'));
    ws.onclose = (e) => this.onClose?.({ code: e && e.code, reason: (e && e.reason) || '' });
  }

  _onJsonMessage(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    switch (m.type) {
      case 'SettingsApplied':
        this.onStatus?.('listo');
        break;
      case 'UserStartedSpeaking':
        this.onStatus?.('escuchando');
        this.onInterrupt?.();
        break;
      case 'UserStoppedSpeaking':
        this.onStatus?.('procesando');
        break;
      case 'FinalTranscript':
        if (m.transcript && m.transcript.trim()) this.onUserText?.(m.transcript.trim(), true);
        break;
      case 'ConversationTextUpdate':
        if (m.role === 'agent' && m.content) this.onAssistantText?.(m.content, false);
        break;
      case 'AgentStartedSpeaking':
        this.onStatus?.('hablando');
        break;
      case 'AgentAudioDone':
        this.onTurnComplete?.();
        break;
      case 'Close':
        this.onStatus?.('cerrado');
        this.close();
        break;
      default:
        break;
    }
  }

  async _onSocketMessage(ev) {
    const d = ev && ev.data;
    if (typeof d === 'string') { this._onJsonMessage(d); return; }
    if (d && typeof d.text === 'function') {
      const text = await d.text();
      if (text) this._onJsonMessage(text);
      return;
    }
    const data = d && typeof d.byteLength === 'number' ? d : null;
    if (data) {
      this.onAudio?.({ pcm16: data, rate: this.outputRate });
    }
  }

  sendAudio(pcm16Bytes) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(pcm16Bytes);
    return true;
  }

  close() { try { if (this.ws) this.ws.close(); } catch { this.ws = null; } }
}

// ---------------------------------------------------------------------------
// Sesion de voz (microfono + worklets + proveedor elegido)
// ---------------------------------------------------------------------------

export class RealtimeVoiceSession {
  constructor({ provider = REALTIME_PROVIDERS.GEMINI_LIVE, apiKey = '', voiceToken = null, geminiModel = GEMINI_DEFAULT_MODEL, geminiVoice = GEMINI_DEFAULT_VOICE,
    language = 'es', prompt = '', agentSettings = null, agentThinkModel = 'gemini-3.1-flash-lite', geminiKey = '',
    onUserText = null, onAssistantText = null, onTurnComplete = null, onStatus = null, onError = null } = {}) {
    this.providerName = provider;
    this._running = false;
    this._ready = false;
    this._connectWatchdog = null;
    this._audioCtx = null;
    this._micNode = null;
    this._sinkNode = null;
    this._stream = null;
    this._lastUserPartial = '';
    this._lastAssistantPartial = '';
    this._cb = { onUserText, onAssistantText, onTurnComplete, onStatus, onError };

    const common = {
      apiKey,
      onUserText: (t, final) => this._onUserText(t, final),
      onAssistantText: (t, final) => this._onAssistantText(t, final),
      onTurnComplete: (why) => this._onTurnComplete(why),
      onStatus: (s) => {
        if (s === 'listo') {
          this._ready = true;
          if (this._connectWatchdog) { clearTimeout(this._connectWatchdog); this._connectWatchdog = null; }
        }
        this._cb.onStatus?.(s);
      },
      onError: (e) => this._cb.onError?.(e),
      onClose: (info) => this._onProviderClose(info),
      onAudio: (a) => this._play(a)
    };

    const token = (voiceToken && voiceToken.provider === provider) ? voiceToken : null;

    if (provider === REALTIME_PROVIDERS.DEEPGRAM_AGENT) {
      this._provider = new DeepgramAgentProvider({
        ...common,
        accessToken: token ? token.token : '',
        apiKey: token ? '' : apiKey,
        settings: agentSettings,
        language,
        prompt,
        geminiKey,
        thinkModel: agentThinkModel,
        onInterrupt: () => this._clearAudio()
      });
    } else {
      this._provider = new GeminiLiveProvider({
        ...common,
        accessToken: token ? token.token : '',
        apiKey: token ? '' : apiKey,
        model: (token && token.model) || geminiModel,
        voice: geminiVoice,
        language,
        prompt
      });
    }
  }

  async start() {
    if (this._running) return;
    this._running = true;
    await this._setupAudio();
    if (!this._running) return; // stop() ocurrio mientras se preparaba el audio
    this._ready = false;
    this._connectWatchdog = setTimeout(() => {
      if (this._running && !this._ready) {
        this._cb.onError?.(new Error('Sin respuesta del servidor (timeout tras 20s). Volvé a intentar.'));
        this.stop();
      }
    }, 20000);
    this._provider.connect();
  }

  async _setupAudio() {
    if (typeof AudioContext === 'undefined') {
      throw new Error('AudioContext no disponible en este contexto.');
    }
    const ctx = new AudioContext();
    this._audioCtx = ctx;
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
      throw new Error('AudioWorklet no disponible en este contexto.');
    }

    const workletUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('voice-worklet.js')
      : 'voice-worklet.js';
    await ctx.audioWorklet.addModule(workletUrl);
    this._sinkNode = new AudioWorkletNode(ctx, 'proob-sink');
    this._sinkNode.connect(ctx.destination);

    if (this._hasOffscreen()) await this._startOffscreenMic();
    else await this._startInlineMic(ctx);
  }

  _hasOffscreen() {
    return typeof chrome !== 'undefined' && !!chrome.offscreen && !!chrome.runtime;
  }

  // Captura directa en la propia pagina (navegadores sin offscreen o solo dev).
  async _startInlineMic(ctx) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
    } catch (err) {
      const name = err && err.name ? err.name : '';
      const detail = (err && err.message) || String(err);
      const friendly = name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Chrome no concedió el micrófono (permítelo en el prompt o en el botón del candado del panel).'
        : name === 'NotFoundError' ? 'No se encontró un micrófono conectado.'
        : detail;
      throw new Error(`Micrófono no disponible: ${friendly}`);
    }
    this._stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    this._micNode = new AudioWorkletNode(ctx, 'proob-mic-capture');
    this._micNode.port.onmessage = (e) => {
      if (this._provider) this._provider.sendAudio(e.data);
    };
    src.connect(this._micNode);
  }

  // Captura en documento offscreen (patron oficial de Chrome: el sidepanel y el
  // popup no pueden mostrar el prompt de getUserMedia). El permiso se pide una
  // vez desde request-mic.html; el offscreen recibe la orden via messaging.
  async _startOffscreenMic() {
    await this._ensureOffscreenDoc();
    this._micListener = (msg) => {
      if (msg && msg.type === 'proob:pcm' && this._provider) this._provider.sendAudio(msg.data);
    };
    chrome.runtime.onMessage.addListener(this._micListener);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'proob:voicestart' });
    } catch (err) {
      throw new Error(`No se pudo iniciar la captura (offscreen): ${(err && err.message) || err}`);
    }
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'No se pudo iniciar la captura del micrófono.');
    }
  }

  async _ensureOffscreenDoc() {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'proob:offscreen', action: 'create' });
    } catch (err) {
      throw new Error(`Offscreen no disponible: ${(err && err.message) || err}`);
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'No se pudo crear el documento offscreen.');
  }

  async _stopOffscreenMic() {
    if (this._micListener) {
      try { chrome.runtime.onMessage.removeListener(this._micListener); } catch { }
      this._micListener = null;
    }
    try { await chrome.runtime.sendMessage({ type: 'proob:voicestop' }); } catch { }
    try { await chrome.runtime.sendMessage({ type: 'proob:offscreen', action: 'close' }); } catch { }
  }

  _play({ pcm16, rate }) {
    if (this._sinkNode) this._sinkNode.port.postMessage({ type: 'pcm16', data: pcm16, rate });
  }

  _clearAudio() {
    if (this._sinkNode) this._sinkNode.port.postMessage({ type: 'clear' });
  }

  _onUserText(t, final) {
    if (t) this._lastUserPartial = t;
    if (final) {
      const txt = t || this._lastUserPartial;
      this._lastUserPartial = '';
      if (txt && txt.trim()) this._cb.onUserText?.(txt.trim());
    }
  }

  _onAssistantText(t, final) {
    if (t) {
      this._lastAssistantPartial = t;
      this._cb.onAssistantText?.(t, false);
    }
  }

  _onTurnComplete(why) {
    if (why === 'interrupted') {
      this._lastAssistantPartial = '';
      return;
    }
    const txt = this._lastAssistantPartial;
    this._lastAssistantPartial = '';
    if (txt && txt.trim()) this._cb.onAssistantText?.(txt.trim(), true);
    this._cb.onTurnComplete?.();
  }

  _onProviderClose(info) {
    const wasRunning = this._running;
    this.stop();
    if (!wasRunning) return;
    this._cb.onStatus?.('desconectado');
    const code = info && info.code;
    const reason = info && info.reason ? String(info.reason) : '';
    const detail = reason || (typeof code === 'number' ? `código ${code}` : '');
    this._cb.onError?.(new Error(`La sesión de voz se cerró${detail ? `: ${detail}` : '.'}`));
  }

  async stop() {
    this._running = false;
    if (this._connectWatchdog) { clearTimeout(this._connectWatchdog); this._connectWatchdog = null; }
    try { if (this._provider) this._provider.close(); } catch { this._provider = null; }
    try { if (this._stream) this._stream.getTracks().forEach((t) => t.stop()); } catch { this._stream = null; }
    try { if (this._audioCtx) await this._audioCtx.close(); } catch { this._audioCtx = null; }
    this._micNode = null;
    this._sinkNode = null;
    await this._stopOffscreenMic();
  }
}