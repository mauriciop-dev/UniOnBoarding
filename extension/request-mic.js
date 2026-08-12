// request-mic.js — Pagina visible que pide el permiso de microfono una vez.
// Chrome solo muestra el prompt de getUserMedia desde una pagina de extension
// visible (no sidepanel ni offscreen); una vez concedido, el origen de la
// extension queda habilitado para los demas contextos.

const statusEl = document.getElementById('status');

async function ask() {
  statusEl.textContent = 'Esperando: Chrome deberia pedir el permiso de microfono...';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    s.getTracks().forEach((t) => t.stop());
    statusEl.textContent = 'Microfono permitido. Ya podes cerrar esta pestana y volver al panel para presionar Hablar.';
    setTimeout(() => window.close(), 2000);
  } catch (e) {
    const name = (e && e.name) || '';
    statusEl.textContent = name === 'NotAllowedError' || name === 'PermissionDeniedError'
      ? 'Bloqueaste el microfono. Para permitirlo: chrome://extensions -> ProOnboarding -> Detalles -> Permisos del sitio -> Microfono -> Permitir; luego volve a apretar "Pedir permiso".'
      : `Error: ${(e && e.message) || e}`;
  }
}

document.getElementById('ask').addEventListener('click', ask);
ask();