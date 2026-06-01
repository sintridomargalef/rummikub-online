// confeti.js — celebración con partículas al ganar.
// Usa los colores del juego (rojo, azul, negro, amarillo) + variantes doradas y blancas.
function lanzarConfeti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:9998;pointer-events:none";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORES = [
    "#c62828", "#e53935",   // rojos
    "#1565c0", "#1e88e5",   // azules
    "#f9a825", "#ffca28",   // amarillos
    "#2e7d32", "#43a047",   // verdes
    "#ffffff", "#ffe082",   // blanco / dorado
    "#ff6f00", "#ff8f00",   // naranja
  ];

  const N = 180;
  const particulas = Array.from({ length: N }, (_, i) => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.8,  // salen de arriba escalonadas
    w: 7  + Math.random() * 9,
    h: 3  + Math.random() * 7,
    color: COLORES[Math.floor(Math.random() * COLORES.length)],
    vx: (Math.random() - 0.5) * 3.5,
    vy: 2.5 + Math.random() * 4.5,
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 9,
    swing: (Math.random() - 0.5) * 0.04,  // oscilación lateral
    t: 0,
  }));

  const DURACION_MS = 5000;
  const FADE_MS = 1200;
  const inicio = Date.now();

  function frame() {
    const ahora = Date.now();
    const transcurrido = ahora - inicio;
    if (transcurrido > DURACION_MS) { canvas.remove(); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const fade = transcurrido > (DURACION_MS - FADE_MS)
      ? 1 - (transcurrido - (DURACION_MS - FADE_MS)) / FADE_MS
      : 1;

    particulas.forEach((p) => {
      p.t += 1;
      p.vx += p.swing;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.07;  // gravedad
      p.rot += p.vrot;

      // rebota lateralmente
      if (p.x < -20) p.x = canvas.width + 20;
      if (p.x > canvas.width + 20) p.x = -20;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
