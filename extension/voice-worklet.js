// voice-worklet.js — AudioWorklet processors para el Modo Voz de ProOnboarding.
//
// proob-mic-capture: captura el microfono en el contexto de audio y emite
//   chunks de PCM16 mono a 16 kHz (20 ms / 320 muestras) via port.
// proob-sink: cola de reproduccion de audio. Recibe PCM16 (con su sample
//   rate origen) o Float32 via port, re-muestrea al sample rate del
//   contexto y lo emite a destination.

class ProobMicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.chunkSamples = 320; // 20 ms a 16 kHz
    this.acc = new Float32Array(0);
  }

  _resample(src, outLen) {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * this.ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = src[i0] || 0;
      const s1 = i0 + 1 < src.length ? src[i0 + 1] : s0;
      out[i] = s0 + (s1 - s0) * frac;
    }
    return out;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    const acc = new Float32Array(this.acc.length + ch.length);
    acc.set(this.acc);
    acc.set(ch, this.acc.length);
    this.acc = acc;

    const needInput = Math.ceil(this.chunkSamples * this.ratio) + 1;
    while (this.acc.length >= needInput) {
      const src = this.acc.subarray(0, needInput);
      const mono = this._resample(src, this.chunkSamples);
      this.acc = this.acc.subarray(needInput);
      const int16 = new Int16Array(this.chunkSamples);
      for (let i = 0; i < mono.length; i++) {
        let s = mono[i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        int16[i] = (s < 0) ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}

class ProobSink extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new Float32Array(0);
    this.suspended = false;
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'pcm16') {
        const int16 = new Int16Array(msg.data);
        const floats = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;
        this._push(floats, msg.rate || 16000);
      } else if (msg.type === 'float') {
        this._push(msg.data, msg.rate || sampleRate);
      } else if (msg.type === 'clear') {
        this.queue = new Float32Array(0);
      } else if (msg.type === 'suspend') {
        this.suspended = true;
      } else if (msg.type === 'resume') {
        this.suspended = false;
      }
    };
  }

  _push(src, srcRate) {
    if (srcRate !== sampleRate) {
      const outLen = Math.round((src.length * sampleRate) / srcRate);
      const out = new Float32Array(outLen);
      const ratio = srcRate / sampleRate;
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = src[i0] || 0;
        const b = i0 + 1 < src.length ? src[i0 + 1] : a;
        out[i] = a + (b - a) * frac;
      }
      this._enqueue(out);
    } else {
      this._enqueue(src);
    }
  }

  _enqueue(data) {
    const q = new Float32Array(this.queue.length + data.length);
    q.set(this.queue);
    q.set(data, this.queue.length);
    this.queue = q;
  }

  process(outputs) {
    const out = outputs && outputs[0];
    if (!out || !out.length || !out[0]) return true;
    const n = out[0].length;
    if (!this.suspended && this.queue.length) {
      const read = Math.min(n, this.queue.length);
      for (let c = 0; c < out.length; c++) {
        out[c].set(this.queue.subarray(0, read));
      }
      if (read < n) {
        for (let c = 0; c < out.length; c++) out[c].fill(0, read);
      }
      this.queue = this.queue.subarray(read);
    } else {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
    }
    return true;
  }
}

registerProcessor('proob-mic-capture', ProobMicCapture);
registerProcessor('proob-sink', ProobSink);