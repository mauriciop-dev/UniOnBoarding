// Side panel: UI principal de ProOnboarding.

import { analyzePageWithFallback } from './ai-engine.js';

const DEFAULT_API_URL = 'https://uni-on-boarding-idcs.vercel.app/api/analyze-page';
const STORAGE_KEYS = { apiUrl: 'proob.apiUrl', lang: 'proob.lang' };

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

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
}

function setLoadingText(text) { $('loading-text').textContent = text; }

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractFromPage() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No se encontro una pestana activa.');
  // Inyectar content script si no esta presente (ej. tras recargar la pagina)
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }).catch(() => {});
  chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['content.css']
  }).catch(() => {});
  // Pequena pausa para que la inyeccion termine
  await new Promise(r => setTimeout(r, 100));
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
    onEnd?.();
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
    onEnd?.();
  };
  u.onerror = () => {
    state.isSpeaking = false;
    updateSpeakButton();
    onEnd?.();
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
  const hl = await highlightOnPage(step.element_selector, step.action_type).catch(() => ({ ok: false }));
  if (!hl.ok) {
    hint.textContent = 'No se pudo resaltar el elemento en pantalla.';
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

    const { data, meta } = await analyzePageWithFallback({
      url: state.pageUrl,
      html: state.pageHtml,
      lang: state.lang,
      dom_hash: state.domHash,
      apiUrl: state.apiUrl,
      onStatus: (s) => setLoadingText(STATUS_MESSAGES[s] || 'Consultando la IA...'),
    });
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

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => { /* voces cargadas */ };
  }
}

(async function init() {
  await loadSettings();
  wire();
  showView('idle');
})();
