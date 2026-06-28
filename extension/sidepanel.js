// Side panel: UI principal de ProOnboarding.
// Flujo:
//   1. Usuario hace clic en "Esta pagina".
//   2. Pedimos al content script del tab activo el HTML limpio.
//   3. POST al API configurado (default: produccion en Vercel).
//   4. Mostramos resumen + recorrido con TTS y resaltado visual.

import { analyzePageWithFallback, getNanoAvailability } from './ai-engine.js';

const DEFAULT_API_URL = 'https://uni-on-boarding-idcs.vercel.app/api/analyze-page';
const STORAGE_KEYS = { apiUrl: 'proob.apiUrl', lang: 'proob.lang' };

// Etiquetas visuales para cada motor de IA
const ENGINE_LABELS = {
  nano: { text: '⚡ Local · Gemini Nano', cls: 'engine-nano' },
  cloud: { text: '☁️ Cloud · API Vercel', cls: 'engine-cloud' },
};

const $ = (id) => document.getElementById(id);

const views = {
  idle: $('view-idle'),
  loading: $('view-loading'),
  summary: $('view-summary'),
  tour: $('view-tour'),
  error: $('view-error')
};

const state = {
  apiUrl: DEFAULT_API_URL,
  lang: 'es',
  pageUrl: '',
  pageTitle: '',
  pageHtml: '',
  domHash: '',
  analysis: null,
  tourSteps: [],
  currentStep: 0,
  speech: null,
  isSpeaking: false
};

// ---------- Vistas ----------
function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
}

function setLoadingText(text) { $('loading-text').textContent = text; }

// ---------- Storage ----------
async function loadSettings() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiUrl, STORAGE_KEYS.lang]);
  state.apiUrl = stored[STORAGE_KEYS.apiUrl] || DEFAULT_API_URL;
  state.lang = stored[STORAGE_KEYS.lang] || 'es';
  $('api-url-input').value = state.apiUrl;
  $('lang-input').value = state.lang;
}

async function saveSettings() {
  const apiUrl = $('api-url-input').value.trim() || DEFAULT_API_URL;
  const lang = $('lang-input').value;
  await chrome.storage.local.set({ [STORAGE_KEYS.apiUrl]: apiUrl, [STORAGE_KEYS.lang]: lang });
  state.apiUrl = apiUrl;
  state.lang = lang;
  $('settings-modal').hidden = true;
}

// ---------- Comunicacion con el content script ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractFromPage() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No se encontro una pestana activa.');
  const EXTRACT_TIMEOUT = 10000;
  try {
    const res = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'PROOB_EXTRACT' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), EXTRACT_TIMEOUT)),
    ]);
    if (!res?.ok) throw new Error(res?.error || 'No se pudo extraer la pagina.');
    return res;
  } catch (e) {
    throw new Error('No se pudo comunicar con la pestana. Recarga la pagina e intenta de nuevo.');
  }
}

async function highlightOnPage(selector, actionType) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, completed: false };
  return chrome.tabs.sendMessage(tab.id, {
    type: 'PROOB_HIGHLIGHT',
    payload: { selector, action_type: actionType }
  });
}

async function clearHighlightOnPage() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PROOB_CLEAR_HIGHLIGHT' });
  } catch (_) { /* ignore */ }
}

// ---------- Badge de motor ----------
function updateEngineBadge(engine) {
  const badge = $('badge-engine');
  if (!badge) return;
  const label = ENGINE_LABELS[engine] || ENGINE_LABELS.cloud;
  badge.textContent = label.text;
  badge.className = `badge-engine ${label.cls}`;
  badge.hidden = false;
}

// Detecta y muestra el motor disponible en la vista idle
async function showEngineStatus() {
  const nano = await getNanoAvailability();
  const statusEl = $('engine-status');
  if (!statusEl) return;
  if (nano === 'readily') {
    statusEl.textContent = '⚡ Gemini Nano (listo)';
    statusEl.className = 'engine-status-pill engine-nano';
  } else if (nano === 'after-download') {
    statusEl.textContent = '⚡ Gemini Nano (requiere descarga)';
    statusEl.className = 'engine-status-pill engine-nano';
  } else {
    statusEl.textContent = '☁️ API cloud (Nano no disponible)';
    statusEl.className = 'engine-status-pill engine-cloud';
  }
  statusEl.hidden = false;
}

// ---------- TTS (Web Speech API) ----------
function pickSpanishVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => v.lang?.toLowerCase().startsWith(state.lang))
      || voices.find(v => v.lang?.toLowerCase().startsWith('es'))
      || voices[0] || null;
}

function speak(text, onEnd) {
  stopSpeaking();
  if (!('speechSynthesis' in window) || !text) {
    onEnd && onEnd();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickSpanishVoice();
  if (v) u.voice = v;
  u.lang = state.lang || 'es';
  u.rate = 1.0;
  u.pitch = 1.0;
  u.onend = () => {
    state.isSpeaking = false;
    updateSpeakButton();
    onEnd && onEnd();
  };
  u.onerror = () => {
    state.isSpeaking = false;
    updateSpeakButton();
    onEnd && onEnd();
  };
  state.speech = u;
  state.isSpeaking = true;
  updateSpeakButton();
  window.speechSynthesis.speak(u);
}

function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  state.isSpeaking = false;
  updateSpeakButton();
}

function updateSpeakButton() {
  const label = $('speak-label');
  if (label) label.textContent = state.isSpeaking ? 'Pausar' : 'Reproducir';
}

// ---------- Render: Resumen ----------
function renderSummary(data, meta) {
  const pa = data.page_analysis || {};
  $('platform-name').textContent = pa.detected_platform_name || 'Pagina analizada';
  $('summary-text').textContent = pa.general_purpose_summary || 'Sin resumen disponible.';
  $('badge-cached').hidden = !meta.cached;
  $('meta-json').textContent = JSON.stringify(meta, null, 2);
  state.analysis = data;
  state.tourSteps = Array.isArray(data.interactive_tour) ? data.interactive_tour : [];
  showView('summary');
}

// ---------- Render: Tour ----------
function renderTourStep(index) {
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

  // Highlight + audio
  highlightOnPage(step.element_selector, step.action_type).catch(() => {});
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

// ---------- Acciones principales ----------
const STATUS_MESSAGES = {
  nano_loading: 'Iniciando Gemini Nano (motor local)...',
  cloud_loading: 'Usando API cloud (Nano no disponible o falló)...',
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

    const { data, meta } = await analyzePageWithFallback({
      url: state.pageUrl,
      html: state.pageHtml,
      lang: state.lang,
      dom_hash: state.domHash,
      apiUrl: state.apiUrl,
      onStatus: (s) => setLoadingText(STATUS_MESSAGES[s] || 'Consultando la IA...'),
    });
    updateEngineBadge(meta.engine);
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

// ---------- Wire-up ----------
function wire() {
  $('analyze-btn').addEventListener('click', analyzeThisPage);
  $('start-tour-btn').addEventListener('click', startTour);
  $('play-welcome-btn').addEventListener('click', () => {
    const t = state.analysis?.page_analysis?.audio_welcome_script;
    if (t) speak(t);
  });
  $('next-btn').addEventListener('click', nextStep);
  $('prev-btn').addEventListener('click', prevStep);
  $('exit-tour-btn').addEventListener('click', exitTour);
  $('retry-btn').addEventListener('click', () => showView('idle'));
  $('speak-step-btn').addEventListener('click', () => {
    if (state.isSpeaking) {
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

  // Carga de voces en algunos navegadores es async.
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => { /* recalcular cuando esten listas */ };
  }
}

(async function init() {
  await loadSettings();
  wire();
  showView('idle');
  // Detecta el motor disponible y lo muestra en la vista inicial
  showEngineStatus().catch(() => {});
})();
