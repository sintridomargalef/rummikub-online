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
    location.href = `/game?room=${data.codigo}&host=1`;
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
    location.href = `/game?room=${codigo}`;
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
  let html = `<table class="ranking-tabla"><thead><tr>
    <th>#</th><th>Jugador</th><th>Partidas</th><th>Victorias</th><th>%</th>
  </tr></thead><tbody>`;
  ranking.forEach((j, i) => {
    const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
    html += `<tr>
      <td>${medalla}</td>
      <td><strong>${escapar(j.nombre)}</strong></td>
      <td>${j.partidas}</td>
      <td>${j.victorias}</td>
      <td>${j.porcentaje}%</td>
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
