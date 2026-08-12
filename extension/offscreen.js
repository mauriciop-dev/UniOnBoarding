// offscreen.js — Captura el microfono en un documento offscreen (razon USER_MEDIA)
// y reenvia el PCM16 al sidepanel via chrome.runtime messaging.
//
// IMPORTANTE: un documento offscreen NO puede mostrar el prompt de permiso de
// microfono. El permiso se concede primero desde request-mic.html (pagina
// visible de la extension); despues de eso getUserMedia funciona aqui sin UI.

const capture = { stream: null, ctx: null, src: null, node: null };

async function start() {
  stop();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('voice-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'proob-mic-capture');
  node.port.onmessage = (e) => {
    chrome.runtime.sendMessage({ type: 'proob:pcm', data: e.data });
  };
  src.connect(node);
  capture.stream = stream;
  capture.ctx = ctx;
  capture.src = src;
  capture.node = node;
}

function stop() {
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