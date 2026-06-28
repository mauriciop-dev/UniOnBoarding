// Función principal para interactuar con la IA Local
async function ejecutarPromptLocal(textoPrompt) {
  // Validamos si el nuevo estándar global existe en el navegador
  if (typeof LanguageModel !== 'undefined') {
    try {
      const availability = await LanguageModel.availability();
      
      if (availability === "readily" || availability === "available") {
        // Inicializamos la sesión forzando el idioma español como exige Chrome
        const session = await LanguageModel.create({
          expectedOutputLanguages: ['es']
        });
        
        // Ejecutamos la inferencia en la GPU local
        const respuesta = await session.prompt(textoPrompt);
        return { exito: true, datos: respuesta };
      } else {
        return { exito: false, error: `El modelo no está listo. Estado: ${availability}` };
      }
    } catch (error) {
      return { exito: false, error: error.message };
    }
  } else {
    return { exito: false, error: "LanguageModel no está definido en este navegador." };
  }
}

// Ejemplo de uso al instalar o accionar la extensión
chrome.runtime.onInstalled.addListener(async () => {
  console.log("Proyecto Antigravity Iniciado.");
  
  const consulta = await ejecutarPromptLocal("Dame una idea millonaria de tres palabras para software.");
  
  if (consulta.exito) {
    console.log("Resultado de Gemini Nano:", consulta.datos);
  } else {
    console.warn("Falló la IA Local. Razón:", consulta.error);
    console.log("Aquí puedes activar el fallback a Gemini 1.5 Flash en la nube.");
  }
});