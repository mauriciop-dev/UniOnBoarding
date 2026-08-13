// offscreen.js — Captura el microfono en un documento offscreen (razon USER_MEDIA)
// y reenvia el PCM16 al sidepanel via chrome.runtime messaging.
//
// IMPORTANTE: un documento offscreen NO puede mostrar el prompt de permiso de
// microfono. El permiso se concede primero desde request-mic.html (pagina
// visible de la extension); despues de eso getUserMedia funciona aqui sin UI.

const capture = { stream: null, ctx: null, src: null, node: null, peakTimer: null };

function peakOfInt16(buf) {
  const arr = new Int16Array(buf);
  let peak = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] < 0 ? -arr[i] : arr[i];
    if (v > peak) peak = v;
  }
  return peak;
}

function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function start() {
  stop();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  });
  const track = stream.getAudioTracks()[0];
  console.log('[proob] mic stream settings:', JSON.stringify(track.getSettings()), 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
  const ctx = new AudioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule('voice-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'proob-mic-capture');
  node.port.onmessage = (e) => {
    if (!capture._logged) { capture._logged = true; console.log('[proob] PCM del microfono llegando al offscreen'); }
    // El ArrayBuffer se neutraliza en transito via chrome.runtime.sendMessage;
    // se manda base64 (clonado binario garantizado) para no perder el audio.
    chrome.runtime.sendMessage({ type: 'proob:pcm', data: bytesToB64(e.data), peak: peakOfInt16(e.data) });
  };
  src.connect(node);
  node.connect(ctx.destination); // imprescindible: sin conexion a destination el worklet no procesa
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const td = new Uint8Array(analyser.fftSize);
  const peakTimer = setInterval(() => {
    analyser.getByteTimeDomainData(td);
    let p = 0;
    for (let i = 0; i < td.length; i++) {
      const v = Math.abs((td[i] - 128) / 128);
      if (v > p) p = v;
    }
    chrome.runtime.sendMessage({ type: 'proob:micpeak', peak: p });
  }, 500);
  capture.stream = stream;
  capture.ctx = ctx;
  capture.src = src;
  capture.node = node;
  capture.peakTimer = peakTimer;
}

function stop() {
  if (capture.peakTimer) { clearInterval(capture.peakTimer); capture.peakTimer = null; }
  if (capture.stream) capture.stream.getTracks().forEach((t) => t.stop());
  if (capture.src) { try { capture.src.disconnect(); } catch { } }
  if (capture.node) { try { capture.node.port.close(); } catch { } }
  if (capture.ctx) { try { capture.ctx.close(); } catch { } }
  capture.stream = capture.ctx = capture.src = capture.node = null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'proob:voicestart') {
    start()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
    return true;
  }
  if (msg.type === 'proob:voicestop') {
    stop();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});