// Service Worker: inyecta content script y abre el side panel.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
  } catch (_) {
    // Puede fallar en paginas restringidas (chrome://, etc.)
  }

  if (chrome.sidePanel) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});
