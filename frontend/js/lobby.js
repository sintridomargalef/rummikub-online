const $ = (id) => document.getElementById(id);
const msg = $("msg");

function setMsg(txt, tipo = "") {
  msg.textContent = txt;
  msg.className = "msg" + (tipo ? " " + tipo : "");
}

function validarNombre() {
  const n = $("nombre").value.trim();
  if (!n) {
    setMsg("Introduce tu nombre", "error");
    return null;
  }
  return n;
}

function recogerReglas() {
  return {
    wrap_13_to_1: document.getElementById("regla-wrap_13_to_1").checked,
    tiempo_total: parseInt(document.getElementById("tiempo-total").value),
    tiempo_turno: parseInt(document.getElementById("tiempo-turno").value),
    juego_extremo: document.getElementById("regla-juego-extremo").checked,
    contra_ia: document.getElementById("regla-contra-ia").checked,
    ver_jugada_directo: document.getElementById("regla-ver-directo").checked,
  };
}

$("btn-crear").addEventListener("click", async () => {
  const nombre = validarNombre();
  if (!nombre) return;
  setMsg("Creando sala…");
  try {
    const r = await fetch("/api/sala", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reglas: recogerReglas() }),
    });
    if (!r.ok) throw new Error("Servidor no responde");
    const data = await r.json();
    sessionStorage.setItem("rk_nombre", nombre);
    location.href = `/game?room=${data.codigo}&host=1&_v=20260523d`;
  } catch (e) {
    setMsg("Error: " + e.message, "error");
  }
});

$("btn-unirse").addEventListener("click", async () => {
  const nombre = validarNombre();
  if (!nombre) return;
  const codigo = $("codigo").value.trim().toUpperCase();
  if (codigo.length !== 4) {
    setMsg("El código debe tener 4 letras", "error");
    return;
  }
  setMsg("Comprobando sala…");
  try {
    const r = await fetch(`/api/sala/${codigo}`);
    if (r.status === 404) {
      setMsg("Sala no encontrada", "error");
      return;
    }
    if (!r.ok) throw new Error("Servidor no responde");
    sessionStorage.setItem("rk_nombre", nombre);
    location.href = `/game?room=${codigo}&_v=20260523d`;
  } catch (e) {
    setMsg("Error: " + e.message, "error");
  }
});

$("codigo").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
});

// Si llegan por un enlace ?join=ABCD, pre-rellenamos el código
const joinParam = new URLSearchParams(location.search).get("join");
if (joinParam) {
  $("codigo").value = joinParam.toUpperCase().slice(0, 4);
  setMsg(`Te uniras a la sala ${joinParam.toUpperCase()}. Pon tu nombre y pulsa "Unirme".`, "ok");
}

// ====== Persistencia de preferencias en localStorage ======
const PREFS_KEY = "rk_prefs";

function guardarPrefs() {
  try {
    const prefs = {
      nombre: $("nombre").value.trim(),
      wrap_13_to_1: $("regla-wrap_13_to_1").checked,
      tiempo_total: $("tiempo-total").value,
      tiempo_turno: $("tiempo-turno").value,
      juego_extremo: $("regla-juego-extremo").checked,
      contra_ia: $("regla-contra-ia").checked,
    };
    // ver-directo solo si existe el elemento
    const verDirecto = $("regla-ver-directo");
    if (verDirecto) prefs.ver_jugada_directo = verDirecto.checked;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {}
}

function cargarPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.nombre)        $("nombre").value = p.nombre;
    if (p.wrap_13_to_1 != null) $("regla-wrap_13_to_1").checked = p.wrap_13_to_1;
    if (p.tiempo_total  != null) $("tiempo-total").value = p.tiempo_total;
    if (p.tiempo_turno  != null) $("tiempo-turno").value = p.tiempo_turno;
    if (p.juego_extremo != null) $("regla-juego-extremo").checked = p.juego_extremo;
    if (p.contra_ia     != null) $("regla-contra-ia").checked = p.contra_ia;
    const verDirecto = $("regla-ver-directo");
    if (verDirecto && p.ver_jugada_directo != null) verDirecto.checked = p.ver_jugada_directo;
    // Sincronizar el select de tiempo_turno si juego_extremo está activo
    if (p.juego_extremo) $("tiempo-turno").disabled = true;
  } catch (_) {}
}

// Cargar al entrar
cargarPrefs();

// Guardar en cada cambio de cualquier campo
["nombre","regla-wrap_13_to_1","tiempo-total","tiempo-turno","regla-juego-extremo","regla-contra-ia","regla-ver-directo"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("change", guardarPrefs);
  el.addEventListener("input",  guardarPrefs);
});

$("nombre").focus();

// ====== Ranking ======
const overlayRanking = $("overlay-ranking");
const btnRanking = $("btn-ranking");
const btnCerrarRanking = $("btn-cerrar-ranking");
const rankingContenido = $("ranking-contenido");

async function cargarRanking() {
  try {
    const r = await fetch("/api/ranking");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    renderRanking(data.ranking);
  } catch (e) {
    rankingContenido.innerHTML = `<p style="text-align:center;color:#c44;">Error al cargar: ${e.message}</p>`;
  }
}

function renderRanking(ranking) {
  if (!ranking || ranking.length === 0) {
    rankingContenido.innerHTML = `<p style="text-align:center;opacity:.7;">Todavía no hay partidas registradas.<br>¡Sé el primero!</p>`;
    return;
  }
  let html = `<table class="ranking-tabla">
  <thead>
    <tr>
      <th rowspan="2" class="rk-pos">#</th>
      <th rowspan="2" class="rk-nombre">Jugador</th>
      <th colspan="3" class="rk-grupo-header rk-humanos">👤 Humanos</th>
      <th class="rk-sep" rowspan="2"></th>
      <th colspan="3" class="rk-grupo-header rk-ia">🤖 IA</th>
    </tr>
    <tr>
      <th class="rk-sub">Partidas</th><th class="rk-sub">Victorias</th><th class="rk-sub rk-pct">%</th>
      <th class="rk-sub">Partidas</th><th class="rk-sub">Victorias</th><th class="rk-sub rk-pct">%</th>
    </tr>
  </thead><tbody>`;
  ranking.forEach((j, i) => {
    const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `<span class="rk-num">${i+1}</span>`;
    const ph  = j.partidas_humano  || 0, vh  = j.victorias_humano || 0;
    const pia = j.partidas_ia      || 0, via = j.victorias_ia     || 0;
    const pch  = ph  ? `<strong>${j.porcentaje_humano}%</strong>` : '<span class="rk-vacio">—</span>';
    const pcia = pia ? `<strong>${j.porcentaje_ia}%</strong>`     : '<span class="rk-vacio">—</span>';
    const classRow = i < 3 ? `rk-top-${i+1}` : "";
    html += `<tr class="${classRow}">
      <td class="rk-pos">${medalla}</td>
      <td class="rk-nombre"><strong>${escapar(j.nombre)}</strong></td>
      <td class="rk-num">${ph || '<span class="rk-vacio">—</span>'}</td>
      <td class="rk-num">${vh || '<span class="rk-vacio">—</span>'}</td>
      <td class="rk-pct">${pch}</td>
      <td class="rk-sep"></td>
      <td class="rk-num">${pia || '<span class="rk-vacio">—</span>'}</td>
      <td class="rk-num">${via || '<span class="rk-vacio">—</span>'}</td>
      <td class="rk-pct">${pcia}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  rankingContenido.innerHTML = html;
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

btnRanking.addEventListener("click", () => {
  rankingContenido.innerHTML = `<p style="text-align:center;opacity:.6;">Cargando…</p>`;
  overlayRanking.classList.remove("hidden");
  cargarRanking();
});

btnCerrarRanking.addEventListener("click", () => overlayRanking.classList.add("hidden"));
overlayRanking.addEventListener("click", (e) => {
  if (e.target === overlayRanking) overlayRanking.classList.add("hidden");
});

// Pie con la versión del programa (commit + fecha)
(async () => {
  const footer = document.getElementById("version-footer");
  if (!footer) return;
  try {
    const r = await fetch("/api/version");
    if (!r.ok) throw new Error();
    const d = await r.json();
    footer.textContent = `Rummikub Online · ${d.commit} · ${d.fecha}`;
  } catch {
    footer.textContent = "Rummikub Online";
  }
})();
