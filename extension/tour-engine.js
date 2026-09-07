// tour-engine.js — Motor de tours guiados para ProOnboarding.
// Orquesta highlights visuales, voz (Gemini Live TTS) y espera de acciones del usuario.

// Cola de instrucciones sincronizada: highlight → speak → esperar audio → siguiente
class InstructionQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async enqueue(instruction) {
    return new Promise((resolve) => {
      this.queue.push({ instruction, resolve });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const { instruction, resolve } = this.queue.shift();
      // 1. Highlight si tiene selector
      if (instruction.selector && window.proobTour) {
        await window.proobTour.highlight(instruction.selector, instruction.text, false);
      }
      // 2. Hablar
      const result = await window.proobVoice?.speakText(instruction.text, instruction.lang);
      // 3. Esperar fin de audio (Gemini Live emite proob-audio-end)
      await this.waitForAudioEnd();
      resolve(result);
      // Pequeña pausa entre instrucciones
      await new Promise(r => setTimeout(r, 300));
    }
    this.processing = false;
  }

  waitForAudioEnd() {
    return new Promise(r => {
      const handler = () => { window.removeEventListener('proob-audio-end', handler); r(); };
      window.addEventListener('proob-audio-end', handler);
      // Safety timeout
      setTimeout(() => { window.removeEventListener('proob-audio-end', handler); r(); }, 10000);
    });
  }
}

// Exponer globalmente para WebMCP tools
window.proobInstructionQueue = new InstructionQueue();

export class TourEngine {
  constructor() {
    this.currentTour = null;
    this.currentStep = 0;
    this.stepQueue = [];
    this.isRunning = false;
    this.highlightOverlay = null;
  }

  async start(tourId, context = {}) {
    if (this.isRunning) await this.stop();
    this.currentTour = TOURS[tourId];
    if (!this.currentTour) throw new Error(`Tour ${tourId} no encontrado`);
    this.currentStep = 0;
    this.isRunning = true;
    this.stepQueue = this.currentTour.steps.map((s, i) => ({ ...s, index: i }));
    await this.runNextStep(context);
    return { success: true, tourId, totalSteps: this.stepQueue.length };
  }

  async runNextStep(context) {
    if (!this.isRunning || this.currentStep >= this.stepQueue.length) {
      await this.complete();
      return;
    }
    const step = this.stepQueue[this.currentStep];
    const mergedContext = { ...context, ...step.context };

    // 1. Highlight + instrucción hablada
    if (step.selector) {
      await this.highlight(step.selector, step.instruction, step.speak !== false);
    }

    // 2. Esperar acción del usuario (click, input, change, etc.)
    if (step.waitFor) {
      const result = await this.waitForAction(step.waitFor, step.timeoutMs || 30000);
      if (!result.success) {
        await this.speak(step.retryInstruction || 'No detecté la acción, inténtalo de nuevo');
        return this.runNextStep(context); // Reintentar mismo paso
      }
      // Guardar resultado en contexto para pasos siguientes
      Object.assign(mergedContext, result.data);
    }

    // 3. Acción post-paso (click automático, navegar, ejecutar script, etc.)
    if (step.action) {
      await this.executeAction(step.action, mergedContext);
    }

    this.currentStep++;
    await this.runNextStep(mergedContext);
  }

  async highlight(selector, instruction, speak = true) {
    this.clearHighlight();

    const el = document.querySelector(selector);
    if (!el) throw new Error(`Selector no encontrado: ${selector}`);

    this.highlightOverlay = document.createElement('div');
    this.highlightOverlay.className = 'proob-highlight-overlay';
    this.highlightOverlay.innerHTML = `
      <div class="proob-spotlight"></div>
      <div class="proob-tooltip">${instruction}</div>
      <div class="proob-pulse"></div>
    `;
    document.body.appendChild(this.highlightOverlay);

    const rect = el.getBoundingClientRect();
    this.highlightOverlay.style.setProperty('--target-top', `${rect.top}px`);
    this.highlightOverlay.style.setProperty('--target-left', `${rect.left}px`);
    this.highlightOverlay.style.setProperty('--target-width', `${rect.width}px`);
    this.highlightOverlay.style.setProperty('--target-height', `${rect.height}px`);

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (speak && instruction) {
      // Usar cola sincronizada para coordinar highlight + voz
      await window.proobInstructionQueue.enqueue({ selector, text: instruction });
    }
  }

  clearHighlight() {
    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
      this.highlightOverlay = null;
    }
  }

  async waitForAction(waitConfig, timeoutMs) {
    const { type, selector, value } = waitConfig;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: 'Timeout' });
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        document.removeEventListener('click', clickHandler, true);
        document.removeEventListener('input', inputHandler, true);
        document.removeEventListener('change', changeHandler, true);
      };

      const clickHandler = (e) => {
        if (type === 'click' && (selector ? e.target.matches(selector) : true)) {
          cleanup();
          resolve({ success: true, data: { clickedSelector: selector, xpath: getXPath(e.target) } });
        }
      };

      const inputHandler = (e) => {
        if (type === 'input' && e.target.matches(selector)) {
          cleanup();
          resolve({ success: true, data: { inputValue: e.target.value, selector } });
        }
      };

      const changeHandler = (e) => {
        if (type === 'change' && e.target.matches(selector)) {
          cleanup();
          resolve({ success: true, data: { changedValue: e.target.value, selector } });
        }
      };

      document.addEventListener('click', clickHandler, true);
      if (type === 'input') document.addEventListener('input', inputHandler, true);
      if (type === 'change') document.addEventListener('change', changeHandler, true);
    });
  }

  async executeAction(action, context) {
    const { type, selector, url, script } = action;
    switch (type) {
      case 'click': {
        const el = document.querySelector(selector);
        if (el) el.click();
        break;
      }
      case 'navigate':
        window.location.href = url;
        break;
      case 'script':
        // Ejecutar script en contexto de la página
        chrome.runtime.sendMessage({ type: 'PROOB_EXECUTE_SCRIPT', script, context });
        break;
    }
  }

  async complete() {
    this.clearHighlight();
    this.isRunning = false;
    await window.proobVoice?.speakText('¡Tour completado! Felicitaciones.');
    this.currentTour = null;
  }

  async stop() {
    this.clearHighlight();
    this.isRunning = false;
    this.currentTour = null;
  }
}

// Helper: XPath
function getXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let idx = 1;
    let sibling = el.previousElementSibling;
    while (sibling) { if (sibling.tagName === el.tagName) idx++; sibling = sibling.previousElementSibling; }
    parts.unshift(`${el.tagName.toLowerCase()}[${idx}]`);
    el = el.parentElement;
  }
  return '/' + parts.join('/');
}

// Definición de tours (pueden cargarse de JSON externo en el futuro)
export const TOURS = {
  'signup-flow': {
    name: 'Registro de usuario',
    steps: [
      { selector: '#email', instruction: 'Escribe tu email corporativo', waitFor: { type: 'input', selector: '#email' }, speak: true },
      { selector: '#password', instruction: 'Crea una contraseña segura', waitFor: { type: 'input', selector: '#password' } },
      { selector: '#submit-btn', instruction: 'Clica en Registrarse', waitFor: { type: 'click', selector: '#submit-btn' } },
      { selector: '.welcome-message', instruction: 'Bienvenido, tour completado', waitFor: null }
    ]
  },
  'dashboard-orientation': {
    name: 'Orientación en Dashboard',
    steps: [
      { selector: '.nav-menu', instruction: 'Aquí está el menú principal de navegación', waitFor: { type: 'click', selector: '.nav-menu' }, speak: true },
      { selector: '.user-profile', instruction: 'Tu perfil de usuario está aquí', waitFor: { type: 'click', selector: '.user-profile' } },
      { selector: '.notifications', instruction: 'Las notificaciones aparecen en esta campana', waitFor: { type: 'click', selector: '.notifications' } },
      { selector: '.help-btn', instruction: '¿Necesitas ayuda? Pulsa este botón', waitFor: { type: 'click', selector: '.help-btn' } }
    ]
  }
};