// voice-worklet.js — AudioWorklet processor para el Modo Voz de ProOnboarding.
//
// proob-mic-capture: captura el microfono en el contexto de audio y emite
//   chunks de PCM16 mono a 16 kHz (20 ms / 320 muestras) via port.
//
// (La reproduccion de la respuesta NO usa worklet: va por AudioBufferSourceNode
// en realtime-voice.js, API clasica mas confiable en Chromium.)

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

registerProcessor('proob-mic-capture', ProobMicCapture);