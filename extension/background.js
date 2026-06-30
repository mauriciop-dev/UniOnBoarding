// Service Worker: abre el side panel e inyecta content script cuando el side panel lo solicite.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

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
