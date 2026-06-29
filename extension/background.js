// Service Worker: abre el side panel e inyecta el content script.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setOptions({ enabled: true }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  chrome.sidePanel?.open({ tabId: tab.id }).catch(() => {});

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }).catch(() => {});
  chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['content.css']
  }).catch(() => {});
});
