#!/usr/bin/env node
// Test rápido del endpoint local: node scripts/test-local.js
// Asegúrate de tener `vercel dev` corriendo en otra terminal.

const url = process.env.TEST_URL || 'http://localhost:3000/api/analyze-page';

const sampleHTML = `
<html>
  <body>
    <nav class="main-nav">
      <a href="#home">Inicio</a>
      <a href="#products">Productos</a>
      <a href="#contact">Contacto</a>
    </nav>
    <section id="hero">
      <h1>Bienvenido a TiendaDemo</h1>
      <button id="btn-cta" class="btn-primary">Comprar ahora</button>
    </section>
    <section id="products">
      <h2>Nuestros productos</h2>
      <div class="product-grid">
        <div class="product-card">Producto A</div>
        <div class="product-card">Producto B</div>
      </div>
    </section>
    <form id="contact-form">
      <input name="email" placeholder="tu@email.com" required />
      <button type="submit">Enviar</button>
    </form>
  </body>
</html>
`;

(async () => {
  console.log('→ POST', url);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://demo.test/',
      html_cleaned: sampleHTML,
      lang: 'es'
    })
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();
  console.log(`← ${res.status} en ${elapsed}ms`);
  console.log(JSON.stringify(data, null, 2));
})();
