// realtime-voice.js — Modo Voz de ProOnboarding.
//
// Sesion de voz bidireccional (hablar y escuchar) con dos proveedores:
//   L1 gemini_live    : Gemini Live API directo (WebSocket BidiGenerateContent,
//                       ~key= en la URL, mensajes JSON setup/realtimeInput/serverContent).
//   A  deepgram_agent : Deepgram Agent API (WebSocket wss://agent.deepgram.com/agent,
//                       auth por Sec-WebSocket-Protocol ['token', KEY], Settings JSON
//                       primero; combina STT + LLM + TTS en una sola sesion).
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
export const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/agent';
export const DEEPGRAM_AGENT_OUTPUT_RATE = 24000;

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

// ---------------------------------------------------------------------------
// Gemini Live (BidiGenerateContent)
// ---------------------------------------------------------------------------

export class GeminiLiveProvider {
  constructor({ apiKey, model = GEMINI_DEFAULT_MODEL, voice = GEMINI_DEFAULT_VOICE, language = 'es', prompt = '', wsUrl = null, wsImpl = null,
    onUserText = null, onAssistantText = null, onTurnComplete = null, onStatus = null, onAudio = null, onError = null, onClose = null }) {
    this.apiKey = apiKey;
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
    const url = this.wsUrl || `${GEMINI_WSS_BASE}?key=${encodeURIComponent(this.apiKey)}`;
    const ws = new WS(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${this.model}`,
          responseModalities: ['AUDIO'],
          systemInstruction: { parts: [{ text: this.prompt || 'Eres un asistente de voz util y conciso.' }] },
          generationConfig: {
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } },
              languageCode: this.language
            }
          }
        }
      }));
      this.onStatus?.('conectando');
    };
    ws.onmessage = (ev) => this._onSocketMessage(ev);
    ws.onerror = () => this.onError?.(new Error('Error de WebSocket Gemini Live'));
    ws.onclose = () => this.onClose?.();
  }

  _onSocketMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
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

export function defaultAgentSettings({ language = 'es', prompt = '', voice = 'aura-2-selena-es', thinkModel = 'gemini-3.1-flash-lite' } = {}) {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: DEEPGRAM_AGENT_OUTPUT_RATE, container: 'none' }
    },
    agent: {
      speak: { provider: { type: 'deepgram', voice } },
      listen: { provider: { type: 'deepgram', version: 'v2', model: 'flux-general-multi' } },
      think: { provider: { type: 'google', model: thinkModel, prompt: prompt || 'Eres el asistente de voz de ProOnboarding. Responde breve y claro, en voz.' } },
      greeting: 'Hola, soy tu guia de ProOnboarding. En que te ayudo?'
    }
  };
}

export class DeepgramAgentProvider {
  constructor({ apiKey, settings = null, url = DEEPGRAM_AGENT_URL, thinkModel = 'gemini-3.1-flash-lite', language = 'es', prompt = '', wsImpl = null,
    onUserText = null, onAssistantText = null, onTurnComplete = null, onInterrupt = null, onStatus = null, onAudio = null, onError = null, onClose = null }) {
    this.apiKey = apiKey;
    this.settings = settings || defaultAgentSettings({ language, prompt, thinkModel });
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
    const ws = new WS(this.url, ['token', this.apiKey]);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.settings));
      this.onStatus?.('configurando');
    };
    ws.onmessage = (ev) => this._onSocketMessage(ev);
    ws.onerror = () => this.onError?.(new Error('Error de WebSocket Deepgram Agent'));
    ws.onclose = () => this.onClose?.();
  }

  _onSocketMessage(ev) {
    if (typeof ev.data === 'string') {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
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
      return;
    }
    const data = ev.data && typeof ev.data.byteLength === 'number' ? ev.data : null;
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
  constructor({ provider = REALTIME_PROVIDERS.GEMINI_LIVE, apiKey, geminiModel = GEMINI_DEFAULT_MODEL, geminiVoice = GEMINI_DEFAULT_VOICE,
    language = 'es', prompt = '', agentSettings = null, agentThinkModel = 'gemini-3.1-flash-lite',
    onUserText = null, onAssistantText = null, onTurnComplete = null, onStatus = null, onError = null } = {}) {
    this.providerName = provider;
    this._running = false;
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
      onStatus: (s) => this._cb.onStatus?.(s),
      onError: (e) => this._cb.onError?.(e),
      onClose: () => this._onProviderClose()
    };

    if (provider === REALTIME_PROVIDERS.DEEPGRAM_AGENT) {
      this._provider = new DeepgramAgentProvider({
        ...common,
        settings: agentSettings || defaultAgentSettings({ language, prompt, thinkModel: agentThinkModel }),
        language,
        prompt,
        onInterrupt: () => this._clearAudio()
      });
    } else {
      this._provider = new GeminiLiveProvider({
        ...common,
        model: geminiModel,
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
    this._provider.connect();
  }

  async _setupAudio() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    if (typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    this._audioCtx = ctx;
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') return;

    const workletUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('voice-worklet.js')
      : 'voice-worklet.js';
    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } catch (err) {
      this._cb.onError?.(err);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    this._stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    this._micNode = new AudioWorkletNode(ctx, 'proob-mic-capture');
    this._micNode.port.onmessage = (e) => {
      if (this._provider) this._provider.sendAudio(e.data);
    };
    src.connect(this._micNode);
    this._sinkNode = new AudioWorkletNode(ctx, 'proob-sink');
    this._sinkNode.connect(ctx.destination);
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

  _onProviderClose() {
    if (this._running) {
      this.stop();
      this._cb.onStatus?.('desconectado');
    }
  }

  async stop() {
    this._running = false;
    try { if (this._provider) this._provider.close(); } catch { this._provider = null; }
    try { if (this._stream) this._stream.getTracks().forEach((t) => t.stop()); } catch { this._stream = null; }
    try { if (this._audioCtx) await this._audioCtx.close(); } catch { this._audioCtx = null; }
    this._micNode = null;
    this._sinkNode = null;
  }
}