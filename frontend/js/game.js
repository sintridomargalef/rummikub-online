// Lógica de la mesa de juego: render, drag & drop, comunicación con servidor.

const params = new URLSearchParams(location.search);
const codigo = (params.get("room") || "").toUpperCase();
const nombre = sessionStorage.getItem("rk_nombre") || "";

if (!codigo || !nombre) {
  location.href = "/";
}

const $ = (id) => document.getElementById(id);
const mesaEl = $("mesa");
const atrilEls = [$("atril-0"), $("atril-1")];   // dos filas
const infoTurno = $("info-turno");
const infoRival = $("info-rival");
const infoMazo = $("info-mazo");
const toast = $("toast");
const overlay = $("overlay");

// ====== Validador local de combinaciones (espejo del backend) ======
function _separar(fichas) {
  const reales = fichas.filter((t) => !t.is_joker);
  const jokers = fichas.length - reales.length;
  return [reales, jokers];
}
function esGrupo(fichas) {
  if (fichas.length < 3 || fichas.length > 4) return false;
  const [reales, jokers] = _separar(fichas);
  if (reales.length === 0) return false;
  const num = reales[0].number;
  if (reales.some((t) => t.number !== num)) return false;
  const colores = reales.map((t) => t.color);
  if (new Set(colores).size !== colores.length) return false;
  return reales.length + jokers <= 4;
}
function esEscaleraLineal(reales, jokers) {
  const color = reales[0].color;
  if (reales.some((t) => t.color !== color)) return false;
  const nums = reales.map((t) => t.number).sort((a, b) => a - b);
  if (new Set(nums).size !== nums.length) return false;
  if (nums[0] < 1 || nums[nums.length - 1] > 13) return false;
  let huecos = 0;
  for (let i = 0; i < nums.length - 1; i++) huecos += nums[i + 1] - nums[i] - 1;
  const jokersRest = jokers - huecos;
  if (jokersRest < 0) return false;
  const espIzq = nums[0] - 1;
  const espDer = 13 - nums[nums.length - 1];
  if (jokersRest > espIzq + espDer) return false;
  const longitud = nums[nums.length - 1] - nums[0] + 1 + jokersRest;
  return longitud <= 13;
}
function esEscalera(fichas, reglas) {
  if (fichas.length < 3) return false;
  const [reales, jokers] = _separar(fichas);
  if (reales.length === 0) return false;
  const color = reales[0].color;
  if (reales.some((t) => t.color !== color)) return false;
  if (esEscaleraLineal(reales, jokers)) return true;
  if (reglas && reglas.wrap_13_to_1) {
    const nums = reales.map((t) => t.number);
    if (nums.includes(1) && !nums.includes(2)) {
      const rotados = reales
        .map((t) => (t.number === 1 ? 14 : t.number))
        .sort((a, b) => a - b);
      if (rotados[0] >= 2 && rotados[rotados.length - 1] <= 14) {
        let huecos = 0;
        for (let i = 0; i < rotados.length - 1; i++)
          huecos += rotados[i + 1] - rotados[i] - 1;
        const jr = jokers - huecos;
        if (jr >= 0) {
          const longitud = rotados[rotados.length - 1] - rotados[0] + 1 + jr;
          const tiene13 = rotados.includes(13) || jr >= 1;
          if (rotados[rotados.length - 1] === 14 && longitud <= 13 && tiene13)
            return true;
        }
      }
    }
  }
  return false;
}
function combinacionValida(fichas, reglas) {
  return esGrupo(fichas) || esEscalera(fichas, reglas);
}

// Snapshot canónico recibido del servidor (referencia para "deshacer").
let snapshotServidor = null;
// Estado local mutable: mesa y atril (atril = [filaSup[], filaInf[]]).
let mesaLocal = [];
let atrilLocal = [[], []];
let miTurno = false;
const yo = nombre;

// ============ Render ============
function renderFicha(tile, dragHabilitado) {
  const div = document.createElement("div");
  div.className = "ficha";
  div.dataset.id = tile.id;
  if (tile.is_joker) {
    div.classList.add("joker");
  } else {
    div.classList.add(tile.color);
    div.textContent = tile.number;
  }
  if (dragHabilitado) attachPointerDrag(div, tile);
  return div;
}

function render() {
  // Mesa: solo arrastrable si es mi turno
  const reglasActivas = (snapshotServidor && snapshotServidor.reglas) || {};
  mesaEl.innerHTML = "";
  mesaLocal.forEach((comb, idx) => {
    const c = document.createElement("div");
    c.className = "combinacion";
    if (!combinacionValida(comb, reglasActivas)) c.classList.add("invalida");
    c.dataset.idx = idx;
    comb.forEach((t) => c.appendChild(renderFicha(t, miTurno)));
    habilitarDropEnCombinacion(c, idx);
    mesaEl.appendChild(c);
  });
  // hueco para nueva combinación
  const nueva = document.createElement("div");
  nueva.className = "combinacion combinacion-nueva";
  nueva.dataset.idx = "nueva";
  nueva.textContent = miTurno ? "Suelta aquí para nueva combinación" : "";
  habilitarDropEnCombinacion(nueva, "nueva");
  mesaEl.appendChild(nueva);

  // Atril: las fichas del atril siempre son arrastrables (para reordenar).
  atrilEls.forEach((el, fila) => {
    el.innerHTML = "";
    atrilLocal[fila].forEach((t) => el.appendChild(renderFicha(t, true)));
  });

  // estado top
  if (snapshotServidor) {
    if (snapshotServidor.ganador) {
      infoTurno.textContent = `¡Ganador: ${snapshotServidor.ganador}!`;
    } else {
      infoTurno.textContent = miTurno ? "Tu turno" : `Turno de ${snapshotServidor.turno}`;
    }
    const rivales = snapshotServidor.rivales_fichas || {};
    infoRival.textContent = Object.entries(rivales)
      .map(([n, c]) => `${n}: ${c} fichas`)
      .join(" · ");
    infoMazo.textContent = `Mazo: ${snapshotServidor.mazo_restante}`;

    // chip de reglas opcionales activas
    const reglas = snapshotServidor.reglas || {};
    const chip = document.getElementById("info-reglas");
    const activas = [];
    if (reglas.wrap_13_to_1) activas.push("1 tras 13");
    if (activas.length) {
      chip.textContent = "Reglas: " + activas.join(", ");
      chip.classList.remove("hidden");
    } else {
      chip.classList.add("hidden");
    }
  }

  document.body.classList.toggle("no-mi-turno", !miTurno);
  const jugadaEnCurso = miTurno && hayCambiosRespectoServidor();
  const hayInvalidas = mesaLocal.some((c) => !combinacionValida(c, reglasActivas));
  $("btn-fin-turno").disabled = !miTurno || hayInvalidas;
  $("btn-fin-turno").title = hayInvalidas
    ? "Tienes combinaciones inválidas (en rojo)"
    : "";
  $("btn-robar").disabled = !miTurno || jugadaEnCurso;
  $("btn-deshacer").disabled = !miTurno || !jugadaEnCurso;
}

function hayCambiosRespectoServidor() {
  if (!snapshotServidor) return false;
  // 1) ¿se ha movido alguna ficha entre atril y mesa? Comparamos conjuntos.
  const atrilIds = [...atrilLocal[0], ...atrilLocal[1]].map((t) => t.id).sort();
  const snapAtril = snapshotServidor.tu_atril.map((t) => t.id).sort();
  if (atrilIds.length !== snapAtril.length) return true;
  for (let i = 0; i < atrilIds.length; i++) {
    if (atrilIds[i] !== snapAtril[i]) return true;
  }
  // 2) ¿se ha reorganizado la mesa? Comparación estructural por ids.
  const mesaActual = JSON.stringify(mesaLocal.map((c) => c.map((t) => t.id)));
  const mesaSnap = JSON.stringify(snapshotServidor.mesa.map((c) => c.map((t) => t.id)));
  return mesaActual !== mesaSnap;
}

// ============ Drag & drop ============
function quitarFicha(tileId) {
  // busca en filas del atril y en mesa, devuelve tile
  for (const fila of atrilLocal) {
    const i = fila.findIndex((t) => t.id === tileId);
    if (i >= 0) return fila.splice(i, 1)[0];
  }
  for (const comb of mesaLocal) {
    const i = comb.findIndex((t) => t.id === tileId);
    if (i >= 0) return comb.splice(i, 1)[0];
  }
  return null;
}

function limpiarCombinacionesVacias() {
  mesaLocal = mesaLocal.filter((c) => c.length > 0);
}

function posicionInsercion(contenedor, clientX) {
  const fichas = contenedor.querySelectorAll(".ficha");
  for (let i = 0; i < fichas.length; i++) {
    const fr = fichas[i].getBoundingClientRect();
    if (clientX < fr.left + fr.width / 2) return i;
  }
  return fichas.length;
}

function habilitarDropEnCombinacion(el, idx) {
  el.dataset.dropTipo = "combinacion";
  el.dataset.dropIdx = String(idx);
}

// Marcamos las dos filas del atril como zonas de drop.
atrilEls.forEach((el, fila) => {
  el.dataset.dropTipo = "atril";
  el.dataset.dropIdx = String(fila);
});

// ============ Pointer drag (funciona en ratón y táctil) ============
let pdrag = null;     // { tile, srcEl, ghost, pointerId, fromX }

function attachPointerDrag(fichaEl, tile) {
  fichaEl.style.touchAction = "none";
  fichaEl.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;  // solo botón principal
    e.preventDefault();
    iniciarDrag(e, fichaEl, tile);
  });
}

function iniciarDrag(e, srcEl, tile) {
  const rect = srcEl.getBoundingClientRect();
  const ghost = srcEl.cloneNode(true);
  ghost.classList.add("ghost");
  ghost.style.position = "fixed";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  ghost.style.width = rect.width + "px";
  ghost.style.height = rect.height + "px";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "1000";
  ghost.style.opacity = "0.85";
  document.body.appendChild(ghost);
  srcEl.classList.add("dragging");

  pdrag = {
    tile,
    srcEl,
    ghost,
    pointerId: e.pointerId,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
  };
  // captura: aunque salgamos del elemento, seguimos recibiendo eventos
  try { srcEl.setPointerCapture(e.pointerId); } catch (_) {}
  posicionarGhost(e.clientX, e.clientY);
  marcarDropTargetSegunPunto(e.clientX, e.clientY);
}

function posicionarGhost(x, y) {
  if (!pdrag) return;
  pdrag.ghost.style.left = (x - pdrag.offsetX) + "px";
  pdrag.ghost.style.top = (y - pdrag.offsetY) + "px";
}

function dropTargetEnPunto(x, y) {
  if (!pdrag) return null;
  const prevDisplay = pdrag.ghost.style.display;
  pdrag.ghost.style.display = "none";
  const el = document.elementFromPoint(x, y);
  pdrag.ghost.style.display = prevDisplay;
  if (!el) return null;
  return el.closest("[data-drop-tipo]");
}

function limpiarMarcasDrop() {
  document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
}

function marcarDropTargetSegunPunto(x, y) {
  limpiarMarcasDrop();
  const target = dropTargetEnPunto(x, y);
  if (target) target.classList.add("drop-target");
}

document.addEventListener("pointermove", (e) => {
  if (!pdrag || e.pointerId !== pdrag.pointerId) return;
  posicionarGhost(e.clientX, e.clientY);
  marcarDropTargetSegunPunto(e.clientX, e.clientY);
});

document.addEventListener("pointerup", (e) => {
  if (!pdrag || e.pointerId !== pdrag.pointerId) return;
  const target = dropTargetEnPunto(e.clientX, e.clientY);
  finalizarDrag(target, e.clientX);
});

document.addEventListener("pointercancel", () => {
  finalizarDrag(null, 0);
});

function finalizarDrag(target, clientX) {
  if (!pdrag) return;
  const { tile, srcEl, ghost } = pdrag;
  ghost.remove();
  srcEl.classList.remove("dragging");
  limpiarMarcasDrop();
  pdrag = null;

  if (!target) return;
  const tipo = target.dataset.dropTipo;
  const idx = target.dataset.dropIdx;

  if (tipo === "combinacion") {
    if (!miTurno) return;
    const t = quitarFicha(tile.id);
    if (!t) return;
    if (idx === "nueva") {
      mesaLocal.push([t]);
    } else {
      const pos = posicionInsercion(target, clientX);
      mesaLocal[parseInt(idx, 10)].splice(pos, 0, t);
    }
    limpiarCombinacionesVacias();
    render();
  } else if (tipo === "atril") {
    const t = quitarFicha(tile.id);
    if (!t) return;
    const pos = posicionInsercion(target, clientX);
    atrilLocal[parseInt(idx, 10)].splice(pos, 0, t);
    limpiarCombinacionesVacias();
    render();
  }
}

// ============ Reconciliación con snapshot del servidor ============
function reconciliarAtril(serverTiles) {
  // serverTiles: array de tile objects (los oficiales según el servidor).
  const idsServidor = new Set(serverTiles.map((t) => t.id));
  // 1) quitar de las filas locales las fichas que ya no están en el servidor.
  for (let f = 0; f < atrilLocal.length; f++) {
    atrilLocal[f] = atrilLocal[f].filter((t) => idsServidor.has(t.id));
  }
  // 2) añadir al final de la fila 1 las fichas nuevas del servidor que no estén ya en local.
  const idsLocales = new Set();
  for (const fila of atrilLocal) for (const t of fila) idsLocales.add(t.id);
  for (const t of serverTiles) {
    if (!idsLocales.has(t.id)) atrilLocal[1].push({ ...t });
  }
}

function aplicarSnapshot(snap) {
  snapshotServidor = snap;
  mesaLocal = snap.mesa.map((comb) => comb.map((t) => ({ ...t })));
  // Si es la primera vez (atril vacío), distribuye en la fila superior por defecto.
  const totalLocal = atrilLocal[0].length + atrilLocal[1].length;
  if (totalLocal === 0) {
    atrilLocal[0] = snap.tu_atril.map((t) => ({ ...t }));
    atrilLocal[1] = [];
  } else {
    reconciliarAtril(snap.tu_atril);
  }
  miTurno = snap.turno === yo && !snap.ganador;
  ocultarEspera();
  render();
}

// ============ Acciones ============
$("btn-fin-turno").addEventListener("click", () => {
  const mesa = mesaLocal.map((c) => c.map((t) => t.id));
  const atril = [...atrilLocal[0], ...atrilLocal[1]].map((t) => t.id);
  sock.enviar({ type: "proponer_jugada", mesa, atril });
});

$("btn-robar").addEventListener("click", () => {
  sock.enviar({ type: "robar" });
});

$("btn-deshacer").addEventListener("click", () => {
  if (snapshotServidor) {
    // Restaura mesa canónica; el atril local se recompone con reconciliación
    // partiendo del estado "vacío" para forzar volcado limpio.
    mesaLocal = snapshotServidor.mesa.map((comb) => comb.map((t) => ({ ...t })));
    // Quitar de atrilLocal cualquier ficha que ahora esté en la mesa (se quedaba ahí
    // tras un drag) y traer todas las del servidor.
    const idsMesa = new Set(mesaLocal.flat().map((t) => t.id));
    for (let f = 0; f < atrilLocal.length; f++) {
      atrilLocal[f] = atrilLocal[f].filter((t) => !idsMesa.has(t.id));
    }
    reconciliarAtril(snapshotServidor.tu_atril);
    render();
  }
});

$("btn-ordenar").addEventListener("click", () => {
  const cmp = (a, b) => {
    if (a.is_joker) return 1;
    if (b.is_joker) return -1;
    if (a.color !== b.color) return a.color.localeCompare(b.color);
    return a.number - b.number;
  };
  // Junta, ordena y reparte: mitad en cada fila para que quepa.
  const todas = [...atrilLocal[0], ...atrilLocal[1]].sort(cmp);
  const mitad = Math.ceil(todas.length / 2);
  atrilLocal[0] = todas.slice(0, mitad);
  atrilLocal[1] = todas.slice(mitad);
  render();
});

$("btn-ayuda").addEventListener("click", () => {
  // Agrupa por colores en orden fijo y ordena de menor a mayor; jokers al final.
  const ORDEN_COLORES = ["rojo", "azul", "negro", "amarillo"];
  const todas = [...atrilLocal[0], ...atrilLocal[1]];
  const grupos = ORDEN_COLORES.map((color) =>
    todas
      .filter((t) => !t.is_joker && t.color === color)
      .sort((a, b) => a.number - b.number)
  );
  const jokers = todas.filter((t) => t.is_joker);
  const bloques = [...grupos, jokers].filter((g) => g.length > 0);

  // Reparte en 2 filas cortando entre bloques (sin partir un color) lo más
  // equilibrado posible.
  const total = bloques.reduce((acc, g) => acc + g.length, 0);
  const objetivo = total / 2;
  let acumulado = 0;
  let mejorCorte = 0;
  let mejorDiff = Infinity;
  for (let i = 0; i <= bloques.length; i++) {
    const diff = Math.abs(acumulado - objetivo);
    if (diff < mejorDiff) {
      mejorDiff = diff;
      mejorCorte = i;
    }
    if (i < bloques.length) acumulado += bloques[i].length;
  }
  atrilLocal[0] = bloques.slice(0, mejorCorte).flat();
  atrilLocal[1] = bloques.slice(mejorCorte).flat();
  render();
});

$("overlay-cerrar").addEventListener("click", () => overlay.classList.add("hidden"));

// ===== Panel de espera con código grande =====
const espera = $("espera");
function mostrarEspera() {
  $("codigo-grande").textContent = codigo;
  $("enlace-preview").textContent = `${location.origin}/?join=${codigo}`;
  espera.classList.remove("hidden");
}
function ocultarEspera() {
  espera.classList.add("hidden");
}

async function copiar(txt, boton) {
  try {
    await navigator.clipboard.writeText(txt);
    const orig = boton.textContent;
    boton.textContent = "¡Copiado!";
    setTimeout(() => { boton.textContent = orig; }, 1500);
  } catch (_) {
    mostrarToast("No se pudo copiar. Selecciona y copia a mano.", "error");
  }
}

$("btn-copiar-codigo").addEventListener("click", (e) => copiar(codigo, e.target));
$("btn-copiar-enlace").addEventListener("click", (e) =>
  copiar(`${location.origin}/?join=${codigo}`, e.target)
);

function mostrarToast(txt, tipo = "") {
  toast.textContent = txt;
  toast.className = "toast " + tipo;
  toast.classList.remove("hidden");
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ============ WebSocket ============
const sock = new RKSocket(codigo, nombre, {
  onOpen: () => { infoTurno.textContent = "Conectado, esperando…"; },
  onClose: () => mostrarToast("Conexión cerrada, reintentando…"),
  lobby: (data) => {
    if (data.esperando) {
      infoTurno.textContent = `Sala ${codigo} — esperando rival`;
      infoRival.textContent = `Jugadores: ${data.jugadores.join(", ")}`;
      mostrarEspera();
    } else {
      ocultarEspera();
    }
  },
  estado: (data) => aplicarSnapshot(data.snapshot),
  error: (data) => mostrarToast(data.msg, "error"),
  fin_partida: (data) => {
    $("overlay-titulo").textContent = data.ganador === yo ? "¡Has ganado!" : "Fin de partida";
    $("overlay-msg").textContent = `Ganador: ${data.ganador}`;
    overlay.classList.remove("hidden");
  },
});
sock.conectar();

infoTurno.textContent = `Sala ${codigo} — conectando…`;
