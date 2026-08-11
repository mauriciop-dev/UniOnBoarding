// tts-provider.js — Motor de voz unificado por capas para ProOnboarding.
//
// Capas:
//   L1 gemini_live : Gemini Live API (stub, se activa en Fase 4)
//   L2 cloud       : API cloud de TTS (/api/tts) — Deepgram/Nova por detrás
//   L3 local       : Web Speech API (speechSynthesis), funciona offline
//
// Conmutación automática:
//   - Sin conexion -> L3. Vuelve a la nube al reconectar (eventos online/offline).
//   - Error 4xx/5xx/red en la nube -> degrada a L3 y reanuda en el chunk exacto.

export const TTS_LAYERS = Object.freeze({
  GEMINI_LIVE: 'gemini_live',
  CLOUD: 'cloud',
  LOCAL: 'local'
});

let voicesLoadedPromise = null;

function waitForVoices() {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  if (!voicesLoadedPromise) {
    voicesLoadedPromise = new Promise((resolve) => {
      const check = () => {
        if (speechSynthesis.getVoices().length) resolve();
      };
      speechSynthesis.onvoiceschanged = check;
      check();
      setTimeout(resolve, 3000);
    });
  }
  return voicesLoadedPromise;
}

const GENDER_KEYWORDS = {
  male: ['male', 'david', 'james', 'mark', 'daniel', 'paul', 'george', 'alex', 'fred', 'ryan',
    'thomas', 'jorge', 'pedro', 'javier', 'carlos', 'miguel', 'juan', 'diego', 'pablo', 'luis',
    'sergio', 'joao', 'rodrigo', 'lucas', 'pietro', 'ramon', 'mateo', 'tom', 'vitor', 'eric',
    'oliver', 'william', 'henry', 'jack', 'sebastian', 'leo', 'mateo', 'noah'],
  female: ['female', 'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'sara', 'kate',
    'sonia', 'monica', 'lucia', 'sofia', 'valentina', 'camila', 'isabel', 'maria', 'paulina',
    'olga', 'julia', 'joana', 'raquel', 'helena', 'leticia', 'fernanda', 'laura', 'zira',
    'ilona', 'amelia', 'emma', 'ava', 'sofia', 'charlotte', 'mia', 'anna', 'lena', 'elena',
    'carmen', 'lucia', 'yolanda', 'aurelie', 'cecilia', 'beatrice', 'serena', 'geneva']
};

function pickVoice(lang, gender) {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const norm = (s) => String(s || '').toLowerCase();
  let cands = voices.filter((v) => norm(v.lang).startsWith(lang));
  if (!cands.length) cands = voices.filter((v) => norm(v.lang).startsWith('es'));
  if (!cands.length) cands = voices;
  const kws = GENDER_KEYWORDS[gender];
  if (kws) {
    const hit = cands.find((v) => kws.some((k) => norm(v.name).includes(k)));
    if (hit) return hit;
  }
  return cands[0] || null;
}

function chunkSentences(text) {
  const parts = String(text || '')
    .split(/(?<=[.!?…])\s+/)
    .map(p => p.trim())
    .filter(Boolean);
  const out = [];
  for (let p of parts) {
    while (p.length > 480) {
      const comma = p.lastIndexOf(',', 450);
      const cut = comma > 200 ? comma : 450;
      out.push(p.slice(0, cut + 1));
      p = p.slice(cut + 1);
    }
    if (p) out.push(p);
  }
  return out.length ? out : [String(text || '')];
}

function playBlob(blob) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); resolve(); };
      a.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Error reproduciendo audio')); };
      a.play().catch((err) => { URL.revokeObjectURL(url); reject(err); });
    } catch (err) {
      reject(err);
    }
  });
}

export class TTSProvider {
  constructor({ cloudEndpoint = null, voiceLang = 'es', voiceGender = null, onLayerChange = null, onOnlineChange = null } = {}) {
    this.cloudEndpoint = cloudEndpoint;
    this.voiceLang = voiceLang || 'es';
    this.voiceGender = voiceGender || null;
    this.onLayerChange = onLayerChange;
    this.onOnlineChange = onOnlineChange;
    this.online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.activeLayer = TTS_LAYERS.LOCAL;
    this.isSpeaking = false;
    this._jobToken = 0;
    waitForVoices().catch(() => {});
    this._bindNetwork();
  }

  configure({ cloudEndpoint, voiceLang, voiceGender } = {}) {
    if (typeof cloudEndpoint === 'string') this.cloudEndpoint = cloudEndpoint;
    if (typeof voiceLang === 'string') this.voiceLang = voiceLang;
    if (voiceGender === 'male' || voiceGender === 'female' || voiceGender === null) this.voiceGender = voiceGender;
  }

  destroy() {
    this.stop();
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this._onOnline);
    window.removeEventListener('offline', this._onOffline);
  }

  _bindNetwork() {
    if (typeof window === 'undefined') return;
    this._onOnline = () => this._setOnline(true);
    this._onOffline = () => this._setOnline(false);
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOffline);
  }

  _setOnline(on) {
    this.online = on;
    this.onOnlineChange?.(on);
    if (!on) {
      this.stop();
      this._setLayer(TTS_LAYERS.LOCAL);
    } else {
      this._setLayer(this._preferredLayer());
    }
  }

  getActiveLayer() {
    return this.activeLayer;
  }

  _setLayer(layer) {
    if (layer === this.activeLayer) return;
    this.activeLayer = layer;
    this.onLayerChange?.(layer);
  }

  _preferredLayer() {
    if (!this.online) return TTS_LAYERS.LOCAL;
    if (this.cloudEndpoint) return TTS_LAYERS.CLOUD;
    return TTS_LAYERS.LOCAL;
  }

  stop() {
    this._jobToken += 1;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.isSpeaking = false;
  }

  async speak(text, opts = {}) {
    this.stop();
    if (!text) { opts.onEnd?.(); return; }
    const token = ++this._jobToken;
    const target = this._preferredLayer();
    this._setLayer(target);

    if (target === TTS_LAYERS.CLOUD && this.cloudEndpoint) {
      try {
        await this._speakCloud(text, { ...opts, token });
      } catch (err) {
        if (token !== this._jobToken) return;
        console.warn('[tts] cloud fallo, degradando a local:', err.message);
        this._setLayer(TTS_LAYERS.LOCAL);
        const resumeAt = typeof err.resumeIndex === 'number' ? err.resumeIndex : (opts.resumeIndex || 0);
        this._speakLocalFrom(text, resumeAt, { ...opts, token });
      }
      return;
    }

    this._setLayer(TTS_LAYERS.LOCAL);
    this._speakLocalFrom(text, opts.resumeIndex || 0, { ...opts, token });
  }

  async _speakCloud(text, opts) {
    const chunks = chunkSentences(text);
    const start = Math.min(Math.max(opts.resumeIndex || 0, 0), Math.max(chunks.length - 1, 0));
    this.isSpeaking = true;
    for (let i = start; i < chunks.length; i++) {
      if (opts.token !== this._jobToken) throw new Error('cancelled');
      let res;
      try {
        res = await fetch(this.cloudEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunks[i], lang: this.voiceLang })
        });
      } catch (err) {
        this.isSpeaking = false;
        err.resumeIndex = i;
        throw err;
      }
      if (!res.ok) {
        this.isSpeaking = false;
        const err = new Error(`TTS ${res.status}`);
        err.status = res.status;
        err.resumeIndex = i;
        throw err;
      }
      const blob = await res.blob();
      await playBlob(blob);
      if (opts.token !== this._jobToken) throw new Error('cancelled');
      opts.onProgress?.(i);
    }
    this.isSpeaking = false;
    opts.onEnd?.();
  }

  _speakLocalFrom(text, startIndex, opts) {
    if (typeof speechSynthesis === 'undefined' || !text) { opts.onEnd?.(); return; }
    const chunks = chunkSentences(text);
    const start = Math.min(Math.max(startIndex | 0, 0), Math.max(chunks.length - 1, 0));
    this.isSpeaking = true;
    const step = (idx) => {
      if (idx >= chunks.length || opts.token !== this._jobToken) {
        this.isSpeaking = false;
        opts.onEnd?.();
        return;
      }
      this._utter(chunks[idx], () => {
        if (opts.token !== this._jobToken) return;
        opts.onProgress?.(idx);
        step(idx + 1);
      });
    };
    step(start);
  }

  _utter(text, onDone) {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(this.voiceLang, this.voiceGender);
    if (v) u.voice = v;
    u.lang = this.voiceLang || 'es';
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onend = () => onDone?.();
    u.onerror = () => onDone?.();
    speechSynthesis.speak(u);
  }
}