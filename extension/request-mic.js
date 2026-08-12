// request-mic.js — Pagina visible que pide el permiso de microfono una vez.
// Chrome solo muestra el prompt de getUserMedia desde una pagina de extension
// visible (no sidepanel ni offscreen); una vez concedido, el origen de la
// extension queda habilitado para los demas contextos.

const statusEl = document.getElementById('status');
const meterWrap = document.getElementById('meter');
const meterBar = document.getElementById('meterBar');
const meterLabel = document.getElementById('meterLabel');

function showMeter(stream, ms) {
  meterWrap.hidden = false;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs((data[i] - 128) / 128);
        if (v > peak) peak = v;
      }
      meterBar.style.width = `${(peak * 100).toFixed(0)}%`;
      meterLabel.textContent = peak < 0.02
        ? `Nivel: 0% (silencio — habla al microfono)`
        : `Nivel: ${(peak * 100).toFixed(0)}% (te esta escuchando!)`;
      if (performance.now() - t0 > ms) {
        meterBar.style.width = '0%';
        meterLabel.textContent = '';
        meterWrap.hidden = true;
        ctx.close();
        resolve(peak);
      } else {
        setTimeout(tick, 100);
      }
    };
    tick();
  });
}

async function ask() {
  statusEl.textContent = 'Esperando: Chrome deberia pedir el permiso de microfono...';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    const track = s.getAudioTracks()[0];
    console.log('[proob] mic visible ok:', JSON.stringify(track.getSettings()), 'muted:', track.muted, 'enabled:', track.enabled);
    statusEl.textContent = 'Microfono conectado. HABLA ahora para medir si Chrome captura tu voz...';
    const peak = await showMeter(s, 3000);
    s.getTracks().forEach((t) => t.stop());
    if (peak < 0.02) {
      statusEl.textContent = 'El microfono esta conectado pero Chrome recibe silencio total. Revisa el microfono de Windows (Configuracion > Sistema > Sonido) y volve a probar.';
    } else {
      statusEl.textContent = 'Microfono permitido y con sonido. Ya podes cerrar esta pestana y volver al panel para presionar Hablar.';
      setTimeout(() => window.close(), 2500);
    }
  } catch (e) {
    const name = (e && e.name) || '';
    statusEl.textContent = name === 'NotAllowedError' || name === 'PermissionDeniedError'
      ? 'Bloqueaste el microfono. Para permitirlo: chrome://extensions -> ProOnboarding -> Detalles -> Permisos del sitio -> Microfono -> Permitir; luego volve a apretar "Pedir permiso".'
      : `Error: ${(e && e.message) || e}`;
  }
}

document.getElementById('ask').addEventListener('click', ask);
ask();