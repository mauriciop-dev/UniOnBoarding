// Side panel: UI principal de ProOnboarding.

import { analyzePageWithFallback } from './ai-engine.js';
import { TTSProvider, TTS_LAYERS } from './tts-provider.js';

const DEFAULT_API_URL = 'https://uni-on-boarding-idcs.vercel.app/api/analyze-page';
const STORAGE_KEYS = { apiUrl: 'proob.apiUrl', lang: 'proob.lang', avatar: 'proob.avatar' };

const LOCAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOCAL_CACHE_MAX = 20;
const CACHE_PREFIX = 'proob.cache.';

async function getLocalAnalysis(domHash, lang) {
  const key = `${CACHE_PREFIX}${domHash}.${lang}`;
  const store = await chrome.storage.local.get([key]);
  const item = store[key];
  if (item && item.ts && (Date.now() - item.ts) < LOCAL_CACHE_TTL_MS) return item.data;
  return null;
}

async function setLocalAnalysis(domHash, lang, data) {
  const key = `${CACHE_PREFIX}${domHash}.${lang}`;
  await chrome.storage.local.set({ [key]: { ts: Date.now(), data } });
  pruneLocalCache();
}

async function pruneLocalCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const entries = Object.keys(all)
      .filter(k => k.startsWith(CACHE_PREFIX))
      .map(k => ({ k, ts: all[k]?.ts || 0 }))
      .sort((a, b) => b.ts - a.ts);
    if (entries.length > LOCAL_CACHE_MAX) {
      await chrome.storage.local.remove(entries.slice(LOCAL_CACHE_MAX).map(e => e.k));
    }
  } catch (_) { /* noop */ }
}

const $ = (id) => document.getElementById(id);

const views = {
  idle: $('view-idle'),
  loading: $('view-loading'),
  summary: $('view-summary'),
  tour: $('view-tour'),
  chat: $('view-chat'),
  error: $('view-error')
};

const state = {
  apiUrl: DEFAULT_API_URL,
  lang: 'es',
  avatar: 'bot',
  pageUrl: '',
  pageTitle: '',
  pageHtml: '',
  domHash: '',
  analysis: null,
  tourSteps: [],
  currentStep: 0,
  chatHistory: [],
  speech: null,
  isSpeaking: false
};

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
}

function setLoadingText(text) { $('loading-text').textContent = text; }

async function loadSettings() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiUrl, STORAGE_KEYS.lang, STORAGE_KEYS.avatar]);
  state.apiUrl = stored[STORAGE_KEYS.apiUrl] || DEFAULT_API_URL;
  state.lang = stored[STORAGE_KEYS.lang] || 'es';
  state.avatar = stored[STORAGE_KEYS.avatar] || 'bot';
  $('api-url-input').value = state.apiUrl;
  $('lang-input').value = state.lang;
  updateAvatarUI();
}

async function saveSettings() {
  const apiUrl = $('api-url-input').value.trim() || DEFAULT_API_URL;
  const lang = $('lang-input').value;
  await chrome.storage.local.set({ [STORAGE_KEYS.apiUrl]: apiUrl, [STORAGE_KEYS.lang]: lang });
  state.apiUrl = apiUrl;
  state.lang = lang;
  configureTts();
  $('settings-modal').hidden = true;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractFromPage() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No se encontro una pestana activa.');
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'PROOB_EXTRACT' });
    if (res?.ok) return res;
    throw new Error(res?.error || 'Error desconocido');
  } catch (e) {
    try {
      await chrome.runtime.sendMessage({ type: 'PROOB_INJECT_CS', tabId: tab.id });
      await new Promise(r => setTimeout(r, 150));
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'PROOB_EXTRACT' });
      if (!res?.ok) throw new Error(res?.error || 'Error desconocido');
      return res;
    } catch (inner) {
      throw new Error('No se pudo acceder al contenido de la pagina. Es posible que sea una pagina restringida (chrome://, pdf, etc). Recarga e intenta de nuevo.');
    }
  }
}

async function highlightOnPage(selector, actionType, extra = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, completed: false };
  return chrome.tabs.sendMessage(tab.id, {
    type: 'PROOB_HIGHLIGHT',
    payload: {
      selector,
      action_type: actionType,
      label: extra.label || '',
      cta: extra.cta || '',
      avatar: state.avatar
    }
  });
}

async function clearHighlightOnPage() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PROOB_CLEAR_HIGHLIGHT' });
  } catch (_) { /* ignore */ }
}

const tts = new TTSProvider({
  onLayerChange: (layer) => updateLayerChip(layer)
});

function deriveTtsEndpoint(apiUrl) {
  const base = String(apiUrl || '')
    .replace(/\/api\/analyze-page\/?$/i, '')
    .replace(/\/+$/, '');
  return base ? `${base}/api/tts` : null;
}

function avatarToGender(avatar) {
  if (avatar === 'man') return 'male';
  if (avatar === 'woman') return 'female';
  return null;
}

function configureTts() {
  tts.configure({
    cloudEndpoint: deriveTtsEndpoint(state.apiUrl),
    voiceLang: state.lang,
    voiceGender: avatarToGender(state.avatar)
  });
}

function updateAvatarUI() {
  document.querySelectorAll('.avatar-opt').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.avatar === state.avatar);
  });
}

async function setAvatar(avatar) {
  state.avatar = avatar;
  await chrome.storage.local.set({ [STORAGE_KEYS.avatar]: avatar });
  updateAvatarUI();
  configureTts();
  try {
    const tab = await getActiveTab();
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'PROOB_AVATAR', avatar });
  } catch (_) { /* no hay tab/pagina activa */ }
}

function updateLayerChip(layer) {
  const chip = $('tts-layer');
  if (!chip) return;
  const labels = {
    [TTS_LAYERS.GEMINI_LIVE]: 'Voz en vivo',
    [TTS_LAYERS.CLOUD]: 'Voz cloud',
    [TTS_LAYERS.LOCAL]: 'Voz local'
  };
  chip.textContent = labels[layer] || layer;
  chip.dataset.layer = layer;
}

function speak(text, onEnd) {
  tts.stop();
  tts.speak(text, {
    onEnd: () => {
      updateSpeakButton();
      onEnd?.();
    }
  });
  updateSpeakButton();
}

function stopSpeaking() {
  tts.stop();
  updateSpeakButton();
}

function updateSpeakButton() {
  const label = $('speak-label');
  if (label) label.textContent = tts.isSpeaking ? 'Pausar' : 'Reproducir';
}

function renderSummary(data, meta) {
  const pa = data.page_analysis || {};
  $('platform-name').textContent = pa.detected_platform_name || 'Pagina analizada';
  $('summary-text').textContent = pa.general_purpose_summary || 'Sin resumen disponible.';
  $('badge-cached').hidden = !meta.cached;
  const pb = $('badge-provider');
  if (meta.provider) {
    pb.hidden = false;
    pb.textContent = meta.source === 'local-cache' ? 'Cache local' : `AI: ${meta.provider}`;
  } else {
    pb.hidden = true;
  }
  $('meta-json').textContent = JSON.stringify(meta, null, 2);
  state.analysis = data;
  state.tourSteps = Array.isArray(data.interactive_tour) ? data.interactive_tour : [];
  $('start-tour-btn').hidden = state.tourSteps.length === 0;
  showView('summary');
}

async function renderTourStep(index) {
  const step = state.tourSteps[index];
  if (!step) return;
  state.currentStep = index;
  $('step-current').textContent = String(step.step_number ?? index + 1);
  $('step-total').textContent = String(state.tourSteps.length);
  $('step-title').textContent = step.title || 'Paso';
  $('step-text').textContent = step.text_explanation || '';
  $('progress-bar').style.width = `${((index + 1) / state.tourSteps.length) * 100}%`;
  $('prev-btn').disabled = index === 0;
  $('next-btn').textContent = index === state.tourSteps.length - 1 ? 'Finalizar' : 'Siguiente';

  const hint = $('action-hint');
  if (step.action_type === 'wait_for_click') hint.textContent = 'Esperando que hagas clic...';
  else if (step.action_type === 'input_required') hint.textContent = 'Escribe en el campo resaltado para continuar.';
  else hint.textContent = '';

  // Esperar highlight visual antes de hablar
  const cta = (step.text_explanation || '').slice(0, 90);
  const hl = await highlightOnPage(step.element_selector, step.action_type, { label: step.title, cta }).catch(() => ({ ok: false }));
  if (!hl.ok) {
    if (hl.skipped) hint.textContent = 'Paso marcado como saltado.';
    else if (hl.completed === false) hint.textContent = 'Paso continuado sin completarse. Sigue con el recorrido.';
    else hint.textContent = 'No se pudo resaltar el elemento en pantalla.';
  }
  if (step.audio_script) speak(step.audio_script);
}

function nextStep() {
  if (state.currentStep < state.tourSteps.length - 1) {
    renderTourStep(state.currentStep + 1);
  } else {
    exitTour();
  }
}

function prevStep() {
  if (state.currentStep > 0) renderTourStep(state.currentStep - 1);
}

async function exitTour() {
  stopSpeaking();
  await clearHighlightOnPage();
  showView('summary');
}

function deriveChatEndpoint(apiUrl) {
  const base = String(apiUrl || '')
    .replace(/\/api\/analyze-page\/?$/i, '')
    .replace(/\/+$/, '');
  return base ? `${base}/api/chat` : null;
}

function addChatBubble(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${role}`;
  const body = document.createElement('div');
  body.className = 'chat-body';
  body.textContent = content;
  wrap.appendChild(body);
  $('chat-messages').appendChild(wrap);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  return wrap;
}

function showChatTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg assistant';
  wrap.id = 'chat-typing';
  wrap.innerHTML = '<div class="chat-body typing"><span></span><span></span><span></span></div>';
  $('chat-messages').appendChild(wrap);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  return wrap;
}

function buildChatContext() {
  const pa = state.analysis?.page_analysis || {};
  const parts = [];
  if (pa.detected_platform_name) parts.push(`Plataforma: ${pa.detected_platform_name}`);
  if (pa.general_purpose_summary) parts.push(`Resumen: ${pa.general_purpose_summary}`);
  if (Array.isArray(state.tourSteps) && state.tourSteps.length) {
    const titles = state.tourSteps.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    parts.push(`Pasos del recorrido:\n${titles}`);
  }
  if (state.pageHtml) parts.push(`HTML de la pagina (fragmento):\n${state.pageHtml.slice(0, 6000)}`);
  return parts.join('\n\n');
}

function openChat() {
  showView('chat');
  const input = $('chat-input');
  input.focus();
  if (!$('chat-messages').children.length) {
    addChatBubble('assistant', 'Preguntame como hacer algo en esta pagina. Ej: "¿Donde esta el boton para exportar?"');
  }
}

async function sendChatMessage() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  $('chat-send').disabled = true;

  addChatBubble('user', text);
  const typing = showChatTyping();

  const endpoint = deriveChatEndpoint(state.apiUrl);
  if (!endpoint) {
    typing.remove();
    addChatBubble('assistant', 'No hay URL de API configurada para el chat.');
    $('chat-send').disabled = false;
    return;
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message: text,
        lang: state.lang,
        pageUrl: state.pageUrl,
        pageContext: buildChatContext(),
        history: state.chatHistory
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    state.chatHistory.push({ role: 'user', content: text });
    state.chatHistory.push({ role: 'assistant', content: data.reply });
    if (state.chatHistory.length > 24) state.chatHistory = state.chatHistory.slice(-24);
    typing.remove();
    const bubble = addChatBubble('assistant', data.reply || '(respuesta vacía)');
    if (data.provider) {
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = `via ${data.provider} · ${Math.round(data.elapsed_ms || 0)}ms`;
      bubble.appendChild(meta);
    }
  } catch (err) {
    typing.remove();
    const msg = err.name === 'AbortError'
      ? 'El servicio tardó demasiado. Intenta otra vez.'
      : (err.message || 'Error desconocido');
    addChatBubble('assistant', `No pude responder: ${msg}`);
  } finally {
    clearTimeout(id);
    $('chat-send').disabled = false;
    input.focus();
  }
}

const STATUS_MESSAGES = {
  cloud_loading: 'Consultando API cloud...',
};

async function analyzeThisPage() {
  try {
    $('analyze-btn').disabled = true;
    showView('loading');
    setLoadingText('Extrayendo DOM de la pagina...');
    const extracted = await extractFromPage();
    state.pageUrl = extracted.url;
    state.pageTitle = extracted.title;
    state.pageHtml = extracted.html;
    state.domHash = extracted.dom_hash;

    $('page-meta').textContent = `${state.pageTitle} - ${state.pageUrl}`;

    const locallyCached = await getLocalAnalysis(state.domHash, state.lang);
    if (locallyCached) {
      renderSummary(locallyCached, { ...locallyCached._meta, cached: true, source: 'local-cache', provider: locallyCached._meta?.provider || 'cache' });
      return;
    }

    const { data, meta } = await analyzePageWithFallback({
      url: state.pageUrl,
      html: state.pageHtml,
      lang: state.lang,
      dom_hash: state.domHash,
      apiUrl: state.apiUrl,
      onStatus: (s) => setLoadingText(STATUS_MESSAGES[s] || 'Consultando la IA...'),
    });
    setLocalAnalysis(state.domHash, state.lang, data);
    renderSummary(data, { ...data._meta, ...meta });
  } catch (err) {
    $('error-text').textContent = err.message || String(err);
    showView('error');
  } finally {
    $('analyze-btn').disabled = false;
  }
}

function startTour() {
  if (!state.tourSteps.length) return;
  showView('tour');
  renderTourStep(0);
}

function wire() {
  $('analyze-btn').addEventListener('click', analyzeThisPage);
  $('start-tour-btn').addEventListener('click', startTour);
  $('ask-btn').addEventListener('click', openChat);
  $('chat-back-btn').addEventListener('click', () => showView('summary'));
  $('chat-send').addEventListener('click', sendChatMessage);
  $('chat-input').addEventListener('input', () => {
    $('chat-send').disabled = !$('chat-input').value.trim();
  });
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  document.querySelectorAll('.avatar-opt').forEach((btn) => {
    btn.addEventListener('click', () => setAvatar(btn.dataset.avatar));
  });
  $('play-welcome-btn').addEventListener('click', () => {
    const t = state.analysis?.page_analysis?.audio_welcome_script;
    if (t) speak(t);
  });
  $('next-btn').addEventListener('click', nextStep);
  $('prev-btn').addEventListener('click', prevStep);
  $('exit-tour-btn').addEventListener('click', exitTour);
  $('retry-btn').addEventListener('click', () => showView('idle'));
  $('speak-step-btn').addEventListener('click', () => {
    if (tts.isSpeaking) {
      stopSpeaking();
    } else {
      const step = state.tourSteps[state.currentStep];
      if (step?.audio_script) speak(step.audio_script);
    }
  });

  $('settings-btn').addEventListener('click', () => {
    $('api-url-input').value = state.apiUrl;
    $('lang-input').value = state.lang;
    $('settings-modal').hidden = false;
  });
  $('settings-cancel').addEventListener('click', () => { $('settings-modal').hidden = true; });
  $('settings-save').addEventListener('click', saveSettings);
  $('settings-modal').addEventListener('click', (e) => {
    if (e.target === $('settings-modal')) $('settings-modal').hidden = true;
  });
}

(async function init() {
  await loadSettings();
  configureTts();
  updateLayerChip(tts.getActiveLayer());
  wire();
  showView('idle');
})();
