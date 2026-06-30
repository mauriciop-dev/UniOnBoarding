// Service Worker: inyecta content script y abre el side panel al hacer clic.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  // Inyectar content script (gesto del usuario activo)
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }).catch(() => {});
  chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['content.css']
  }).catch(() => {});
  // Abrir panel sincronamente (requiere gesto)
  chrome.sidePanel?.open({ tabId: tab.id }).catch(() => {});
});

// Fallback: el side panel puede pedir inyeccion si recargo la pagina
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PROOB_INJECT_CS' && msg.tabId) {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      files: ['content.js']
    }).then(() => chrome.scripting.insertCSS({
      target: { tabId: msg.tabId },
      files: ['content.css']
    })).then(() => sendResponse({ ok: true }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
