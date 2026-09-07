[Ir al contenido principal](https://developer.chrome.com/docs/ai/agents?hl=es-419#main-content)

[![Chrome for Developers](https://www.gstatic.com/devrel-devsite/prod/v5e941f15ff6710591bee254538202655020220785b40a3f4d932e94adb9f6037/chrome/images/lockup.svg)](https://developer.chrome.com/)

`/`

Language

- [English](https://developer.chrome.com/docs/ai/agents)
- [Deutsch](https://developer.chrome.com/docs/ai/agents?hl=de)
- [Español – América Latina](https://developer.chrome.com/docs/ai/agents?hl=es-419)
- [Français](https://developer.chrome.com/docs/ai/agents?hl=fr)
- [Indonesia](https://developer.chrome.com/docs/ai/agents?hl=id)
- [Italiano](https://developer.chrome.com/docs/ai/agents?hl=it)
- [Nederlands](https://developer.chrome.com/docs/ai/agents?hl=nl)
- [Polski](https://developer.chrome.com/docs/ai/agents?hl=pl)
- [Português – Brasil](https://developer.chrome.com/docs/ai/agents?hl=pt-br)
- [Tiếng Việt](https://developer.chrome.com/docs/ai/agents?hl=vi)
- [Türkçe](https://developer.chrome.com/docs/ai/agents?hl=tr)
- [Русский](https://developer.chrome.com/docs/ai/agents?hl=ru)
- [עברית](https://developer.chrome.com/docs/ai/agents?hl=he)
- [العربيّة](https://developer.chrome.com/docs/ai/agents?hl=ar)
- [فارسی](https://developer.chrome.com/docs/ai/agents?hl=fa)
- [हिंदी](https://developer.chrome.com/docs/ai/agents?hl=hi)
- [বাংলা](https://developer.chrome.com/docs/ai/agents?hl=bn)
- [ภาษาไทย](https://developer.chrome.com/docs/ai/agents?hl=th)
- [中文 – 简体](https://developer.chrome.com/docs/ai/agents?hl=zh-cn)
- [中文 – 繁體](https://developer.chrome.com/docs/ai/agents?hl=zh-tw)
- [日本語](https://developer.chrome.com/docs/ai/agents?hl=ja)
- [한국어](https://developer.chrome.com/docs/ai/agents?hl=ko)

[Acceder](https://developer.chrome.com/_d/signin?continue=https%3A%2F%2Fdeveloper.chrome.com%2Fdocs%2Fai%2Fagents%3Fhl%3Des-419&prompt=select_account)

- [Docs](https://developer.chrome.com/docs?hl=es-419)
- [AI on Chrome](https://developer.chrome.com/docs/ai?hl=es-419)

![](https://developer.chrome.com/_static/images/translated.svg?hl=es-419)

Google utiliza tecnología de IA para traducir contenido a tu idioma preferido. Las traducciones realizadas con IA pueden contener errores.


Switch to English


- [Página principal](https://developer.chrome.com/?hl=es-419)
- [Docs](https://developer.chrome.com/docs?hl=es-419)
- [AI on Chrome](https://developer.chrome.com/docs/ai?hl=es-419)
- [WebMCP y agentes](https://developer.chrome.com/docs/ai/agents?hl=es-419)

![](https://developer.chrome.com/static/docs/ai/images/hero-sm.png?hl=es-419)

### WebMCP y agentes de IA

Crea sitios web y aplicaciones que funcionen para los usuarios y sus agentes de IA.



[Comenzar](https://developer.chrome.com/docs/ai/webmcp?hl=es-419) [Unirse a la prueba de origen arrow\_forward](https://developer.chrome.com/origintrials/?hl=es-419#/register_trial/4163014905550602241)

Paso 1

### Tus herramientas de registro de sitios

Tu sitio declara las acciones que un agente puede realizar, como herramientas de WebMCP. Cada herramienta tiene un nombre, una descripción y un esquema JSON.

```
// Imperative API
document.modelContext.registerTool({
  name: "bookSlot",
  title: "Book a consultation slot",
  description: "Reserve a 30-minute consultation.",
  inputSchema: {
    type: "object",
    properties: {
      date:  { type: "string", format: "date" },
      time:  { type: "string" },
      name:  { type: "string" },
      email: { type: "string", format: "email" }
    },
    required: ["date", "time", "name", "email"]
  },
  annotations: { readOnlyHint: false },
  execute: async (input, client) => {
    return await api.book(input);
  }
});
```

Paso 2

### El navegador los expone

El navegador recopila y presenta estas herramientas al agente WebMCP-aware del usuario, junto con la URL, el título y el alcance del permiso de origen de la página.

![Tu sitio se comunica con el navegador, que traduce la información para el agente.](https://developer.chrome.com/static/docs/ai/agents/images/webmcp-horizontal-600.jpg?hl=es-419)

Paso 3

### El agente toma medidas rápidas y confiables

El agente ve un contrato, proporciona argumentos estructurados y tu código hace el resto. El usuario se mantiene informado para obtener el permiso y la confirmación. Es más rápido y confiable que la activación.

```
// the agent's view
{
  "tool": "bookSlot",
  "arguments": {
    "date": "2026-07-31",
    "time": "14:00",
    "name": "Jerry Jones",
    "email": "jerry.jones@example.com"
  }
}
```

### [Cuándo usar WebMCP](https://developer.chrome.com/docs/ai/webmcp/use-cases?hl=es-419)

Descubre oportunidades para que tu sitio ayude a los usuarios y agentes a ser más eficientes agregando herramientas de WebMCP.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/use-cases?hl=es-419)

### [API imperativa](https://developer.chrome.com/docs/ai/webmcp/imperative-api?hl=es-419)

Define herramientas de WebMCP con JavaScript estándar para ejecutar funciones específicas del sitio, como la entrada de formularios y la navegación por el sitio.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/imperative-api?hl=es-419)

### [API declarativa](https://developer.chrome.com/docs/ai/webmcp/declarative-api?hl=es-419)

Transforma tus formularios HTML estándar en herramientas de WebMCP agregando anotaciones.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/declarative-api?hl=es-419)

### [Evaluaciones de WebMCP](https://developer.chrome.com/docs/ai/webmcp/evals?hl=es-419)

Prueba tus herramientas para confirmar que los agentes comprenden cuándo llamar a la herramienta, cómo ejecutarla y qué respuestas son aceptables.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/evals?hl=es-419)

### [Prácticas recomendadas](https://developer.chrome.com/docs/ai/webmcp/best-practices?hl=es-419)

Conoce las prácticas recomendadas para usar las APIs de WebMCP.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/best-practices?hl=es-419)

### [Seguridad de la herramienta de WebMCP](https://developer.chrome.com/docs/ai/webmcp/secure-tools?hl=es-419)

Aprende a crear herramientas seguras para tu sitio web.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/secure-tools?hl=es-419)

### [WebMCP y MCP](https://developer.chrome.com/docs/ai/webmcp/compare-mcp?hl=es-419)

En conjunto, WebMCP y MCP ayudan a los agentes a realizar tareas personalizadas en nombre de los usuarios humanos.



[Leer el documento](https://developer.chrome.com/docs/ai/webmcp/compare-mcp?hl=es-419)

code


### Orientación sobre la Web moderna


Usa la Guía para la Web Moderna con tus agentes de programación de IA favoritos para acceder a las prácticas recomendadas para la Web en tu flujo de trabajo preferido.

```
npx modern-web-guidance@latest install
```

[Consulta los documentos](https://developer.chrome.com/docs/modern-web-guidance?hl=es-419)

code


### Crea extensiones con agentes de programación

Usa la guía de la Web moderna para crear extensiones más rápido con la ayuda de agentes de programación.



[Leer el documento](https://developer.chrome.com/docs/extensions/ai/build-with-ai?hl=es-419)

![](https://developer.chrome.com/static/docs/ai/agents/images/gemini_inchrome.jpg?hl=es-419)

### Conoce Gemini en Chrome

Asistencia de IA, sin salir de tu navegador. Obtén resúmenes de lo más importante, aclara conceptos y encuentra respuestas basadas en tus pestañas abiertas.

Gemini funciona en todas tus apps de Google para ayudarte a lo largo del día.

[Descubre Gemini en Chrome arrow\_forward](https://gemini.google/overview/gemini-in-chrome/?hl=es-419)

[web.dev](https://web.dev/explore/ai?hl=es-419)

### [¿Qué son los agentes de IA?](https://web.dev/articles/ai-agents?hl=es-419)

Comprende los conceptos básicos y las definiciones de las diversas tecnologías emergentes, a menudo denominadas IA.



[Leer el documento](https://web.dev/articles/ai-agents?hl=es-419)

[web.dev](https://web.dev/explore/ai?hl=es-419)

### [Crea sitios web aptos para agentes](https://web.dev/articles/ai-agent-site-ux?hl=es-419)

Como profesionales de la Web, es fundamental crear nuevas tecnologías con cuidado y responsabilidad.



[Leer el documento](https://web.dev/articles/ai-agent-site-ux?hl=es-419)

[web.dev](https://web.dev/learn/ai/?hl=es-419)

### [Aprende sobre IA](https://web.dev/learn/ai?hl=es-419)

Crea una base de conocimiento sobre la IA para agregar funciones a tus sitios web y aplicaciones web.



[Hacer el curso](https://web.dev/learn/ai?hl=es-419)




\[\[\["Fácil de comprender","easyToUnderstand","thumb-up"\],\["Resolvió mi problema","solvedMyProblem","thumb-up"\],\["Otro","otherUp","thumb-up"\]\],\[\["Falta la información que necesito","missingTheInformationINeed","thumb-down"\],\["Muy complicado o demasiados pasos","tooComplicatedTooManySteps","thumb-down"\],\["Desactualizado","outOfDate","thumb-down"\],\["Problema de traducción","translationIssue","thumb-down"\],\["Problema con las muestras o los códigos","samplesCodeIssue","thumb-down"\],\["Otro","otherDown","thumb-down"\]\],\[\],\[\],\[\]\]