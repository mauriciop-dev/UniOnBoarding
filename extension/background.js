// Service Worker: inyecta content script y abre el side panel.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    // Inyectar content script y CSS solo cuando el usuario hace clic
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
