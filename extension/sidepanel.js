// Side panel: UI principal de ProOnboarding.

import { analyzePageWithFallback } from './ai-engine.js';
import { TTSProvider, TTS_LAYERS } from './tts-provider.js';
import { RealtimeVoiceSession, REALTIME_PROVIDERS, GEMINI_DEFAULT_MODEL } from './realtime-voice.js';

const DEFAULT_API_URL = 'https://uni-on-boarding-idcs.vercel.app/api/analyze-page';
const STORAGE_KEYS = {
  apiUrl: 'proob.apiUrl',
  lang: 'proob.lang',
  avatar: 'proob.avatar',
  voiceboxUrl: 'proob.voiceboxUrl',
  feedback: 'proob.feedback',
  voiceProvider: 'proob.voiceProvider',
  geminiKey: 'proob.geminiKey',
  geminiModel: 'proob.geminiModel',
  deepgramKey: 'proob.deepgramKey',
  agentSettings: 'proob.agentSettings'
};

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
  voiceboxUrl: '',
  pageUrl: '',
  pageTitle: '',
  pageHtml: '',
  domHash: '',
  analysis: null,
  tourSteps: [],
  currentStep: 0,
  chatHistory: [],
  feedbackRating: 0,
  speech: null,
  isSpeaking: false,
  voiceProvider: REALTIME_PROVIDERS.GEMINI_LIVE,
  voiceSession: null,
  geminiKey: '',
  geminiModel: GEMINI_DEFAULT_MODEL,
  deepgramKey: '',
  agentSettings: ''
  ,currentIntent: ''
  ,currentTarget: null
  ,domObserverActive: false
};

let lastMainView = 'idle';

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  if (name !== 'chat') {
    lastMainView = name;
    if (state.voiceSession) stopVoice();
  }
  const chatTab = $('tab-chat');
  const inicioTab = $('tab-inicio');
  if (chatTab) chatTab.classList.toggle('active', name === 'chat');
  if (inicioTab) inicioTab.classList.toggle('active', name !== 'chat');
}

function switchTab(name) {
  if (name === 'chat') showView('chat');
  else showView(lastMainView);
}

function setLoadingText(text) { $('loading-text').textContent = text; }

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiUrl, STORAGE_KEYS.lang, STORAGE_KEYS.avatar, STORAGE_KEYS.voiceboxUrl,
    STORAGE_KEYS.voiceProvider, STORAGE_KEYS.geminiKey, STORAGE_KEYS.geminiModel,
    STORAGE_KEYS.deepgramKey, STORAGE_KEYS.agentSettings
  ]);
  state.apiUrl = stored[STORAGE_KEYS.apiUrl] || DEFAULT_API_URL;
  state.lang = stored[STORAGE_KEYS.lang] || 'es';
  state.avatar = stored[STORAGE_KEYS.avatar] || 'bot';
  state.voiceboxUrl = stored[STORAGE_KEYS.voiceboxUrl] || '';
  state.voiceProvider = stored[STORAGE_KEYS.voiceProvider] || REALTIME_PROVIDERS.GEMINI_LIVE;
  state.geminiKey = stored[STORAGE_KEYS.geminiKey] || '';
  state.geminiModel = stored[STORAGE_KEYS.geminiModel] || GEMINI_DEFAULT_MODEL;
  state.deepgramKey = stored[STORAGE_KEYS.deepgramKey] || '';
  state.agentSettings = stored[STORAGE_KEYS.agentSettings] || '';
  $('api-url-input').value = state.apiUrl;
  $('lang-input').value = state.lang;
  $('voicebox-url-input').value = state.voiceboxUrl;
  $('gemini-key-input').value = state.geminiKey;
  $('gemini-model-input').value = state.geminiModel;
  $('deepgram-key-input').value = state.deepgramKey;
  $('agent-settings-input').value = state.agentSettings;
  updateAvatarUI();
}

async function saveSettings() {
  const apiUrl = $('api-url-input').value.trim() || DEFAULT_API_URL;
  const lang = $('lang-input').value;
  const voiceboxUrl = $('voicebox-url-input').value.trim();
  const geminiKey = $('gemini-key-input').value.trim();
  const geminiModel = $('gemini-model-input').value.trim() || GEMINI_DEFAULT_MODEL;
  const deepgramKey = $('deepgram-key-input').value.trim();
  const agentSettings = $('agent-settings-input').value.trim();
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiUrl]: apiUrl,
    [STORAGE_KEYS.lang]: lang,
    [STORAGE_KEYS.voiceboxUrl]: voiceboxUrl,
    [STORAGE_KEYS.geminiKey]: geminiKey,
    [STORAGE_KEYS.geminiModel]: geminiModel,
    [STORAGE_KEYS.deepgramKey]: deepgramKey,
    [STORAGE_KEYS.agentSettings]: agentSettings
  });
  state.apiUrl = apiUrl;
  state.lang = lang;
  state.voiceboxUrl = voiceboxUrl;
  state.geminiKey = geminiKey;
  state.geminiModel = geminiModel;
  state.deepgramKey = deepgramKey;
  state.agentSettings = agentSettings;
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

async function preparePageContext() {
  const extracted = await extractFromPage();
  state.pageUrl = extracted.url;
  state.pageTitle = extracted.title;
  state.pageHtml = extracted.html;
  state.domHash = extracted.dom_hash;
  try {
    const tab = await getActiveTab();
    await chrome.tabs.sendMessage(tab.id, { type: 'PROOB_START_OBSERVER' });
    state.domObserverActive = true;
  } catch (_) { /* observer opcional */ }
  $('page-meta').textContent = `${state.pageTitle} - ${state.pageUrl}`;
  return extracted;
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
    voiceGender: avatarToGender(state.avatar),
    localEndpoint: state.voiceboxUrl || null
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
    [TTS_LAYERS.VOICEBOX]: 'Voicebox',
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
  fillContextCards(pa, meta);
  fillChatContext(pa);
  showView('summary');
  maybeShowFeedback();
}

function fillContextCards(pa, meta) {
  const cards = $('context-cards');
  if (!cards) return;
  $('card-platform').textContent = pa.detected_platform_name || '—';
  $('card-steps').textContent = state.tourSteps.length ? `${state.tourSteps.length} pasos` : '—';
  $('card-provider').textContent = meta.provider || '—';
  cards.hidden = false;
}

function fillChatContext(pa) {
  const cc = $('chat-context');
  if (!cc) return;
  const body = $('chat-context-body');
  const lines = [];
  if (state.pageTitle) lines.push(`📄 ${state.pageTitle}`);
  lines.push(`🏷 ${pa.detected_platform_name || 'Página analizada'}`);
  lines.push(`👣 ${state.tourSteps.length} pasos de recorrido`);
  body.textContent = lines.join('\n');
  if (state.tourSteps.length) {
    const btn = document.createElement('button');
    btn.className = 'ghost cc-start';
    btn.textContent = 'Iniciar recorrido';
    btn.addEventListener('click', () => startTour());
    body.appendChild(btn);
  }
  cc.hidden = false;
}

const FEEDBACK_TTL_MS = 24 * 60 * 60 * 1000;

function deriveFeedbackEndpoint(apiUrl) {
  const base = String(apiUrl || '')
    .replace(/\/api\/analyze-page\/?$/i, '')
    .replace(/\/+$/, '');
  return base ? `${base}/api/feedback` : null;
}

async function feedbackAlreadySent() {
  const store = await chrome.storage.local.get([STORAGE_KEYS.feedback]);
  const ts = store[STORAGE_KEYS.feedback];
  return Boolean(ts && (Date.now() - ts) < FEEDBACK_TTL_MS);
}

function setFeedbackRating(n) {
  state.feedbackRating = n;
  document.querySelectorAll('#feedback-stars .star').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.value) <= n);
  });
  $('feedback-send').disabled = n < 1;
}

async function maybeShowFeedback() {
  const card = $('feedback-card');
  if (!card) return;
  if (await feedbackAlreadySent()) { card.hidden = true; return; }
  state.feedbackRating = 0;
  $('feedback-comment').value = '';
  $('feedback-comment').disabled = false;
  document.querySelectorAll('#feedback-stars .star').forEach((b) => { b.disabled = false; });
  $('feedback-status').textContent = '';
  setFeedbackRating(0);
  if (chrome.runtime?.id) {
    const link = $('feedback-store-link');
    link.href = `https://chromewebstore.google.com/detail/${chrome.runtime.id}`;
    link.hidden = false;
  }
  card.hidden = false;
}

async function sendFeedback() {
  const rating = state.feedbackRating || 0;
  if (rating < 1) return;
  const comment = $('feedback-comment').value.trim();
  $('feedback-send').disabled = true;
  const status = $('feedback-status');
  status.textContent = 'Enviando...';
  const endpoint = deriveFeedbackEndpoint(state.apiUrl);
  const payload = {
    rating,
    comment,
    url: state.pageUrl,
    platform: state.analysis?.page_analysis?.detected_platform_name || '',
    provider: state.analysis?._meta?.provider || '',
    lang: state.lang
  };
  try {
    if (endpoint) {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json()).catch(() => ({}));
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.feedback]: Date.now() });
    status.textContent = '¡Gracias por tu feedback!';
    $('feedback-comment').disabled = true;
    document.querySelectorAll('#feedback-stars .star').forEach((b) => { b.disabled = true; });
  } catch (err) {
    status.textContent = 'No se pudo enviar. Reintenta en un momento.';
    $('feedback-send').disabled = false;
  }
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
  maybeShowFeedback();
}

function deriveApiBase(apiUrl) {
  return String(apiUrl || '')
    .replace(/\/api\/analyze-page\/?$/i, '')
    .replace(/\/+$/, '');
}

function deriveChatEndpoint(apiUrl) {
  const base = deriveApiBase(apiUrl);
  return base ? `${base}/api/chat` : null;
}

async function fetchVoiceToken(provider) {
  const base = deriveApiBase(state.apiUrl);
  if (!base) return { error: 'API no configurada' };
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${base}/api/voice-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ provider })
    });
    clearTimeout(id);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) return { error: (data && data.error) || `HTTP ${res.status}` };
    if (!data || !data.token) return { error: 'La API respondió sin token' };
    return { provider, token: data.token, model: data.model || null };
  } catch (err) {
    return { error: err && err.name === 'AbortError' ? 'Timeout de tu API' : ((err && err.message) || 'Fallo de red') };
  }
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

const SUGGESTIONS = [
  (platform) => platform ? `¿Cómo empiezo a usar ${platform}?` : '¿Cómo empiezo a usar esta página?',
  () => '¿Dónde está la configuración?',
  () => '¿Cómo guardo o exporto mis datos?'
];

function renderSuggestions() {
  const wrap = $('chat-suggestions');
  if (!wrap) return;
  const platform = state.analysis?.page_analysis?.detected_platform_name || '';
  wrap.innerHTML = '';
  SUGGESTIONS.forEach((fn) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = fn(platform);
    b.addEventListener('click', () => {
      $('chat-input').value = fn(platform);
      $('chat-send').disabled = false;
      sendChatMessage();
    });
    wrap.appendChild(b);
  });
}

function openChat() {
  showView('chat');
  renderSuggestions();
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

  const endpoint = state.apiUrl;
  if (!endpoint) {
    typing.remove();
    addChatBubble('assistant', 'No hay URL de API configurada para el chat.');
    $('chat-send').disabled = false;
    return;
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 30000);
  try {
    if (!state.pageHtml) await preparePageContext();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        url: state.pageUrl,
        html_cleaned: state.pageHtml,
        lang: state.lang,
        intent: text,
        previous_action: state.currentTarget?.title || ''
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    state.chatHistory.push({ role: 'user', content: text });
    state.currentIntent = text;
    state.currentTarget = data.target || null;
    state.chatHistory.push({ role: 'assistant', content: data.message || 'No encontré una acción concreta.' });
    if (state.chatHistory.length > 24) state.chatHistory = state.chatHistory.slice(-24);
    typing.remove();
    const bubble = addChatBubble('assistant', data.message || '(respuesta vacía)');
    if (data.target?.selector) {
      const actionType = data.target.action_type === 'input' ? 'input_required' : data.target.action_type === 'click' ? 'wait_for_click' : 'highlight';
      await highlightOnPage(data.target.selector, actionType, { label: data.target.title, cta: data.message });
    }
    if (Array.isArray(data.suggestions) && data.suggestions.length) {
      addChatBubble('assistant', `Sugerencias: ${data.suggestions.map(s => s.label).join(' · ')}`);
    }
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

const VOICE_STATUS_TEXT = {
  conectando: 'Conectando...',
  listo: 'Voz activa',
  escuchando: 'Escuchando...',
  procesando: 'Procesando...',
  hablando: 'Respondiendo...',
  cerrado: 'Sesión cerrada',
  desconectado: 'Desconectado',
  'usando herramienta': 'Buscando info...',
  interrumpido: 'Interrumpido'
};

function setVoiceStatus(text, cls = '') {
  const el = $('voice-status');
  if (!el) return;
  el.textContent = text;
  el.className = `voice-status${cls ? ` ${cls}` : ''}`;
}

function mapVoiceStatus(s) {
  setVoiceStatus(VOICE_STATUS_TEXT[s] || s, s === 'listo' ? 'live' : '');
  if (s === 'desconectado') {
    state.voiceSession = null;
    const btn = $('voice-btn');
    if (btn) btn.classList.remove('active');
    if ($('voice-btn-label')) $('voice-btn-label').textContent = 'Hablar';
  }
}

function safeParseJson(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function buildVoicePrompt() {
  const pa = state.analysis?.page_analysis || {};
  const ctx = buildChatContext();
  const lines = [
    'Eres el guía de voz de ProOnboarding. Respondes siempre en español de Latinoamérica.',
    `El usuario navega por: ${pa.detected_platform_name || 'una página web'}.`
  ];
  if (ctx) lines.push(`Contexto de la página:\n${ctx}`);
  lines.push('Reglas: responde de forma breve (una idea), natural para voz, sin listas largas.');
  return lines.join('\n\n');
}

let voiceAssistantEl = null;

function appendVoiceAssistant(txt, final) {
  if (!voiceAssistantEl) {
    voiceAssistantEl = addChatBubble('assistant', txt);
  } else {
    const body = voiceAssistantEl.querySelector('.chat-body');
    if (body) body.textContent = txt;
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  }
  if (final) voiceAssistantEl = null;
}

async function startVoice() {
  stopSpeaking();
  showView('chat');
  const provider = $('voice-provider').value;
  state.voiceProvider = provider;

  // Produccion: token efimero del backend (sin keys del usuario). Fallback:
  // clave directa solo en desarrollo.
  let voiceToken = await fetchVoiceToken(provider);
  let apiKey = '';
  if (!voiceToken.token) {
    apiKey = provider === REALTIME_PROVIDERS.DEEPGRAM_AGENT ? state.deepgramKey : state.geminiKey;
    if (!apiKey) {
      const reason = voiceToken.error ? ` (${voiceToken.error})` : '';
      setVoiceStatus(`Voz no disponible: tu API no emite token${reason} y no hay key local`, 'error');
      return;
    }
  }

  const prompt = buildVoicePrompt();
  const agentSettings = provider === REALTIME_PROVIDERS.DEEPGRAM_AGENT ? safeParseJson(state.agentSettings) : null;

  const session = new RealtimeVoiceSession({
    provider,
    apiKey,
    voiceToken,
    geminiKey: state.geminiKey,
    geminiModel: state.geminiModel || GEMINI_DEFAULT_MODEL,
    language: state.lang,
    prompt,
    agentSettings,
    onUserText: (txt) => addChatBubble('user', txt),
    onAssistantText: (txt, final) => appendVoiceAssistant(txt, final),
    onTurnComplete: () => setVoiceStatus('Voz activa', 'live'),
    onStatus: (s) => mapVoiceStatus(s),
    onError: (err) => {
      setVoiceStatus(`Error: ${err?.message || err}`, 'error');
      stopVoice();
    }
  });
  state.voiceSession = session;

  const btn = $('voice-btn');
  btn.classList.add('active');
  $('voice-btn-label').textContent = 'Detener';
  setVoiceStatus('Escuchando...', '');

  try {
    await session.start();
    setVoiceStatus('Voz activa', 'live');
  } catch (err) {
    const msg = (err && err.message) || String(err);
    const permIssue = /permiso|permission|NotAllowed|PermissionDismissed|dismissed/i.test(msg);
    stopVoice();
    if (permIssue) {
      setVoiceStatus('Necesito permiso del micrófono: se abrió una pestaña para pedirlo. Hacé clic en Permitir y después volvé y presioná Hablar otra vez.', 'error');
      chrome.tabs.create({ url: chrome.runtime.getURL('request-mic.html') }).catch(() => {});
    } else {
      setVoiceStatus(`Error: ${msg}`, 'error');
    }
  }
}

async function stopVoice() {
  const s = state.voiceSession;
  state.voiceSession = null;
  voiceAssistantEl = null;
  const btn = $('voice-btn');
  btn.classList.remove('active');
  $('voice-btn-label').textContent = 'Hablar';
  const statusEl = $('voice-status');
  if (!statusEl || !statusEl.classList.contains('error')) setVoiceStatus('Voz desactivada');
  if (s) { try { await s.stop(); } catch { void s.stop(); } }
}

async function toggleVoice() {
  if (state.voiceSession) await stopVoice();
  else await startVoice();
}

async function analyzeThisPage() {
  try {
    $('analyze-btn').disabled = true;
    await preparePageContext();
    openChat();
    addChatBubble('assistant', 'Ya estoy listo. Dime qué quieres hacer en esta página o elige una sugerencia.');
  } catch (err) {
    $('error-text').textContent = err.message || String(err);
    showView('error');
  } finally {
    $('analyze-btn').disabled = false;
  }
}

function startTour() { openChat(); }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'PROOB_DOM_CHANGED' || !state.currentTarget) return;
  // El DOM cambió después de una acción; el siguiente mensaje usará un
  // snapshot fresco en lugar de reutilizar el contexto anterior.
  state.pageHtml = '';
  addChatBubble('assistant', 'Detecté un cambio en la página. ¿Qué quieres hacer ahora?');
});

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
  $('tab-inicio').addEventListener('click', () => switchTab('inicio'));
  $('tab-chat').addEventListener('click', () => switchTab('chat'));
  document.querySelectorAll('.avatar-opt').forEach((btn) => {
    btn.addEventListener('click', () => setAvatar(btn.dataset.avatar));
  });
  document.querySelectorAll('#feedback-stars .star').forEach((btn) => {
    btn.addEventListener('click', () => setFeedbackRating(Number(btn.dataset.value)));
  });
  $('feedback-send').addEventListener('click', sendFeedback);
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
    $('voicebox-url-input').value = state.voiceboxUrl;
    $('gemini-key-input').value = state.geminiKey;
    $('gemini-model-input').value = state.geminiModel;
    $('deepgram-key-input').value = state.deepgramKey;
    $('agent-settings-input').value = state.agentSettings;
    $('settings-modal').hidden = false;
  });
  $('settings-cancel').addEventListener('click', () => { $('settings-modal').hidden = true; });
  $('settings-save').addEventListener('click', saveSettings);
  $('settings-modal').addEventListener('click', (e) => {
    if (e.target === $('settings-modal')) $('settings-modal').hidden = true;
  });

  const voiceBtn = $('voice-btn');
  if (voiceBtn) voiceBtn.addEventListener('click', toggleVoice);
  const voiceProvider = $('voice-provider');
  if (voiceProvider) {
    voiceProvider.value = state.voiceProvider;
    voiceProvider.addEventListener('change', (e) => {
      state.voiceProvider = e.target.value;
      chrome.storage.local.set({ [STORAGE_KEYS.voiceProvider]: e.target.value });
    });
  }
}

(async function init() {
  await loadSettings();
  configureTts();
  updateLayerChip(tts.getActiveLayer());
  wire();
  showView('idle');
})();
