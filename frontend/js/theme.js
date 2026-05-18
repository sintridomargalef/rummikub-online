// Gestor de temas: lee/guarda el tema en localStorage y mantiene sincronizado el selector.
(function () {
  const TEMAS = ["theme-classic", "theme-cyberpunk", "theme-nature", "theme-desert"];
  const DEFAULT = "theme-classic";

  function aplicar(tema) {
    if (!TEMAS.includes(tema)) tema = DEFAULT;
    TEMAS.forEach((t) => document.body.classList.remove(t));
    document.body.classList.add(tema);
    try { localStorage.setItem("rk_theme", tema); } catch (_) {}
    const sel = document.getElementById("theme-select");
    if (sel) sel.value = tema;
  }

  const guardado = (() => {
    try { return localStorage.getItem("rk_theme"); } catch (_) { return null; }
  })();
  aplicar(guardado || DEFAULT);

  document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("theme-select");
    if (sel) {
      sel.value = document.body.classList.contains("theme-cyberpunk")
        ? "theme-cyberpunk"
        : document.body.classList.contains("theme-nature")
        ? "theme-nature"
        : document.body.classList.contains("theme-desert")
        ? "theme-desert"
        : "theme-classic";
      sel.addEventListener("change", (e) => aplicar(e.target.value));
    }
  });
})();
