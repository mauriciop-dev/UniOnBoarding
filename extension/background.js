// Service Worker: abre el side panel cuando el usuario hace clic en el icono de la extension.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});
