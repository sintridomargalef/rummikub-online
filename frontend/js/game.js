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
const infoTiempo = $("info-tiempo");
const toast = $("toast");
const overlay = $("overlay");

// ====== Sonido ======
let sonidoActivo = (() => {
  try { return localStorage.getItem("rk_sonido") !== "off"; } catch (_) { return true; }
})();
let audioCtx = null;
function clicSonido() {
  if (!sonidoActivo) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 800;
    o.type = "square";
    g.gain.setValueAtTime(0.10, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.05);
  } catch (_) {}
}
function actualizarBotonSonido() {
  const btn = $("btn-sonido");
  if (btn) btn.textContent = sonidoActivo ? "🔊" : "🔇";
}

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
// Estado local mutable: mesa y atril.
// Atril es ahora una rejilla 2 filas × SLOTS columnas. Cada celda contiene un tile o null.
const ATRIL_FILAS = 2;
const ATRIL_SLOTS_MIN = 16;       // arranca con 16, crece automáticamente si hace falta
let mesaLocal = [];
let atrilLocal = [Array(ATRIL_SLOTS_MIN).fill(null), Array(ATRIL_SLOTS_MIN).fill(null)];
let miTurno = false;
const yo = nombre;

const SLOTS_BUFFER_DERECHA = 2;  // siempre 2 huecos extra a la derecha de la última ficha

function totalSlots() {
  return Math.max(atrilLocal[0].length, atrilLocal[1].length);
}

function ultimaColumnaConFicha() {
  let max = -1;
  for (let f = 0; f < ATRIL_FILAS; f++) {
    for (let c = atrilLocal[f].length - 1; c >= 0; c--) {
      if (atrilLocal[f][c]) { if (c > max) max = c; break; }
    }
  }
  return max;
}

function slotsNecesarios() {
  return Math.max(ATRIL_SLOTS_MIN, ultimaColumnaConFicha() + 1 + SLOTS_BUFFER_DERECHA);
}

function asegurarSlots(min) {
  for (let f = 0; f < ATRIL_FILAS; f++) {
    while (atrilLocal[f].length < min) atrilLocal[f].push(null);
  }
}

function compactarTail() {
  // mantiene siempre N huecos a la derecha de la última ficha, y al menos ATRIL_SLOTS_MIN totales
  const objetivo = slotsNecesarios();
  for (let f = 0; f < ATRIL_FILAS; f++) {
    while (atrilLocal[f].length > objetivo) atrilLocal[f].pop();
    while (atrilLocal[f].length < objetivo) atrilLocal[f].push(null);
  }
}

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

    if (miTurno) {
      const handle = document.createElement("div");
      handle.className = "combo-handle";
      handle.title = "Arrastra para mover la combinación";
      attachCombinacionDrag(handle, c, idx);
      c.appendChild(handle);
    }

    const fichasDiv = document.createElement("div");
    fichasDiv.className = "fichas";
    comb.forEach((t) => fichasDiv.appendChild(renderFicha(t, miTurno)));
    c.appendChild(fichasDiv);

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

  // Atril: rejilla con slots fijos. Cada celda es una zona de drop independiente.
  asegurarSlots(ATRIL_SLOTS_MIN);
  const slots = totalSlots();
  atrilEls.forEach((el, fila) => {
    el.innerHTML = "";
    for (let col = 0; col < slots; col++) {
      const tile = atrilLocal[fila][col];
      const slotEl = document.createElement("div");
      slotEl.className = tile ? "" : "slot";
      slotEl.dataset.dropTipo = "atril";
      slotEl.dataset.dropFila = String(fila);
      slotEl.dataset.dropCol = String(col);
      if (tile) {
        slotEl.appendChild(renderFicha(tile, true));
      }
      el.appendChild(slotEl);
    }
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
  $("btn-deshacer").disabled = !miTurno || (undoStack.length === 0 && !jugadaEnCurso);
  $("btn-rehacer").disabled = !miTurno || redoStack.length === 0;
}

function fichasEnAtril() {
  const res = [];
  for (const fila of atrilLocal) for (const t of fila) if (t) res.push(t);
  return res;
}

function hayCambiosRespectoServidor() {
  if (!snapshotServidor) return false;
  const atrilIds = fichasEnAtril().map((t) => t.id).sort();
  const snapAtril = snapshotServidor.tu_atril.map((t) => t.id).sort();
  if (atrilIds.length !== snapAtril.length) return true;
  for (let i = 0; i < atrilIds.length; i++) {
    if (atrilIds[i] !== snapAtril[i]) return true;
  }
  const mesaActual = JSON.stringify(mesaLocal.map((c) => c.map((t) => t.id)));
  const mesaSnap = JSON.stringify(snapshotServidor.mesa.map((c) => c.map((t) => t.id)));
  return mesaActual !== mesaSnap;
}

// ============ Drag & drop ============
function quitarFicha(tileId) {
  // busca en slots del atril (no compacta) y en combinaciones de la mesa (compacta).
  for (let f = 0; f < atrilLocal.length; f++) {
    const col = atrilLocal[f].findIndex((t) => t && t.id === tileId);
    if (col >= 0) {
      const t = atrilLocal[f][col];
      atrilLocal[f][col] = null;
      return t;
    }
  }
  for (const comb of mesaLocal) {
    const i = comb.findIndex((t) => t.id === tileId);
    if (i >= 0) return comb.splice(i, 1)[0];
  }
  return null;
}

function primerSlotLibre() {
  asegurarSlots(ATRIL_SLOTS_MIN);
  for (let f = 0; f < ATRIL_FILAS; f++) {
    const col = atrilLocal[f].findIndex((x) => x == null);
    if (col >= 0) return { fila: f, col };
  }
  // ninguna libre → ampliar
  for (let f = 0; f < ATRIL_FILAS; f++) atrilLocal[f].push(null);
  return { fila: 0, col: atrilLocal[0].length - 1 };
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

// ============ Drag de combinación entera (asa) ============
let combodrag = null;  // { srcIdx, srcEl, ghost, pointerId, offsetX, offsetY }

function attachCombinacionDrag(handle, combEl, idx) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (!miTurno) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = combEl.getBoundingClientRect();
    const ghost = combEl.cloneNode(true);
    ghost.classList.add("combo-ghost");
    ghost.style.position = "fixed";
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "1000";
    ghost.style.opacity = "0.85";
    ghost.style.transform = "scale(1.03)";
    document.body.appendChild(ghost);
    combEl.classList.add("combo-dragging");
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    combodrag = {
      srcIdx: idx,
      srcEl: combEl,
      ghost,
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    marcarComboObjetivo(e.clientX, e.clientY);
  });
}

function moverComboGhost(x, y) {
  if (!combodrag) return;
  combodrag.ghost.style.left = (x - combodrag.offsetX) + "px";
  combodrag.ghost.style.top  = (y - combodrag.offsetY) + "px";
}

function limpiarMarcasCombo() {
  document.querySelectorAll(".combo-drop-before, .combo-drop-after").forEach((el) => {
    el.classList.remove("combo-drop-before", "combo-drop-after");
  });
}

function comboObjetivoEnPunto(x, y) {
  // Devuelve { idx, side: 'before'|'after' } o null
  let mejor = null, mejorDist = Infinity, mejorLado = "after";
  document.querySelectorAll(".combinacion").forEach((el) => {
    if (el.dataset.idx === undefined) return;
    const i = parseInt(el.dataset.idx, 10);
    if (Number.isNaN(i)) return;
    const r = el.getBoundingClientRect();
    if (y < r.top - 30 || y > r.bottom + 30) return; // fuera de la fila visual
    const cx = r.left + r.width / 2;
    const dx = Math.abs(x - cx);
    if (dx < mejorDist) {
      mejorDist = dx;
      mejor = i;
      mejorLado = x < cx ? "before" : "after";
    }
  });
  if (mejor === null) return null;
  return { idx: mejor, side: mejorLado };
}

function marcarComboObjetivo(x, y) {
  limpiarMarcasCombo();
  const obj = comboObjetivoEnPunto(x, y);
  if (!obj) return;
  const target = document.querySelector(`.combinacion[data-idx="${obj.idx}"]`);
  if (target) target.classList.add(obj.side === "before" ? "combo-drop-before" : "combo-drop-after");
}

function finalizarComboDrag(x, y) {
  if (!combodrag) return;
  const { srcIdx, srcEl, ghost } = combodrag;
  ghost.remove();
  srcEl.classList.remove("combo-dragging");
  limpiarMarcasCombo();
  const obj = comboObjetivoEnPunto(x, y);
  combodrag = null;
  if (!obj) return;
  // Calcular nueva posición destino
  let dst = obj.idx + (obj.side === "after" ? 1 : 0);
  if (dst > srcIdx) dst--; // al quitar el src, los índices a la derecha se reducen
  if (dst === srcIdx) return; // sin cambio
  guardarParaDeshacer();
  const [movida] = mesaLocal.splice(srcIdx, 1);
  mesaLocal.splice(dst, 0, movida);
  clicSonido();
  render();
}

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
  if (!el) return slotMasCercano(x, y);
  const directo = el.closest("[data-drop-tipo]");
  if (directo) return directo;
  // Si caímos fuera de cualquier zona de drop, intentamos el slot más cercano.
  return slotMasCercano(x, y);
}

function slotMasCercano(x, y) {
  // Busca el slot del atril cuyo centro esté más cerca del punto, dentro de un radio razonable.
  let mejor = null;
  let mejorDist = 80 * 80;  // ~80px de tolerancia
  document.querySelectorAll('[data-drop-tipo="atril"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d < mejorDist) { mejorDist = d; mejor = el; }
  });
  return mejor;
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
  if (combodrag && e.pointerId === combodrag.pointerId) {
    moverComboGhost(e.clientX, e.clientY);
    marcarComboObjetivo(e.clientX, e.clientY);
    return;
  }
  if (!pdrag || e.pointerId !== pdrag.pointerId) return;
  posicionarGhost(e.clientX, e.clientY);
  marcarDropTargetSegunPunto(e.clientX, e.clientY);
});

document.addEventListener("pointerup", (e) => {
  if (combodrag && e.pointerId === combodrag.pointerId) {
    finalizarComboDrag(e.clientX, e.clientY);
    return;
  }
  if (!pdrag || e.pointerId !== pdrag.pointerId) return;
  const target = dropTargetEnPunto(e.clientX, e.clientY);
  finalizarDrag(target, e.clientX);
});

document.addEventListener("pointercancel", () => {
  if (combodrag) {
    combodrag.ghost.remove();
    combodrag.srcEl.classList.remove("combo-dragging");
    limpiarMarcasCombo();
    combodrag = null;
  }
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

  if (tipo === "combinacion") {
    if (!miTurno) return;
    guardarParaDeshacer();
    const idx = target.dataset.dropIdx;
    // Caso especial: swap de joker
    if (idx !== "nueva") {
      const idxNum = parseInt(idx, 10);
      const comb = mesaLocal[idxNum];
      const posJoker = comb.findIndex((t) => t.is_joker);
      if (posJoker >= 0 && !tile.is_joker && puedeSustituirJoker(comb, posJoker, tile)) {
        const joker = comb[posJoker];
        // quitar la ficha del atril
        let quitada = false;
        for (let f = 0; f < atrilLocal.length && !quitada; f++) {
          const c = atrilLocal[f].findIndex((x) => x && x.id === tile.id);
          if (c >= 0) { atrilLocal[f][c] = null; quitada = true; }
        }
        if (quitada) {
          comb[posJoker] = tile;
          // joker al primer slot libre del atril
          const libre = primerSlotLibre();
          atrilLocal[libre.fila][libre.col] = joker;
          limpiarCombinacionesVacias();
          compactarTail();
          autoOrdenarSiEsEscalera(idxNum);
          clicSonido();
          render();
          mostrarToast("Joker reemplazado y añadido a tu atril", "ok");
          return;
        }
      }
    }
    const t = quitarFicha(tile.id);
    if (!t) return;
    if (idx === "nueva") {
      mesaLocal.push([t]);
    } else {
      const pos = posicionInsercion(target, clientX);
      const idxNum = parseInt(idx, 10);
      mesaLocal[idxNum].splice(pos, 0, t);
      autoOrdenarSiEsEscalera(idxNum);
    }
    limpiarCombinacionesVacias();
    compactarTail();
    clicSonido();
    render();
  } else if (tipo === "atril") {
    const fila = parseInt(target.dataset.dropFila, 10);
    const col = parseInt(target.dataset.dropCol, 10);
    // Si el slot destino ya contiene esta misma ficha, no hacer nada
    if (atrilLocal[fila][col] && atrilLocal[fila][col].id === tile.id) return;
    guardarParaDeshacer();
    // Buscar y quitar la ficha de su origen
    let origen = null;
    for (let f = 0; f < atrilLocal.length; f++) {
      const c = atrilLocal[f].findIndex((x) => x && x.id === tile.id);
      if (c >= 0) { origen = { f, c }; atrilLocal[f][c] = null; break; }
    }
    let t = null;
    if (origen) {
      t = tile;
    } else {
      // venía de la mesa
      t = quitarFicha(tile.id);
      if (!t) return;
    }
    // Si el slot destino está ocupado, swap (la ficha que estaba va al origen
    // si lo hubo, si no, al primer slot libre)
    if (atrilLocal[fila][col]) {
      const desplazada = atrilLocal[fila][col];
      atrilLocal[fila][col] = t;
      if (origen) {
        atrilLocal[origen.f][origen.c] = desplazada;
      } else {
        const libre = primerSlotLibre();
        atrilLocal[libre.fila][libre.col] = desplazada;
      }
    } else {
      atrilLocal[fila][col] = t;
    }
    limpiarCombinacionesVacias();
    compactarTail();
    clicSonido();
    render();
  }
}

// ============ Auto-ordenar escalera + sustitución de joker ============
function autoOrdenarSiEsEscalera(idx) {
  const comb = mesaLocal[idx];
  if (!comb || comb.length < 2) return;
  const reales = comb.filter((t) => !t.is_joker);
  if (reales.length === 0) return;
  const color = reales[0].color;
  const todasMismoColor = reales.every((t) => t.color === color);
  const numerosDistintos = new Set(reales.map((t) => t.number)).size === reales.length;
  if (!todasMismoColor || !numerosDistintos) return; // grupo, no escalera
  // ordenar reales ascendente, intercalar jokers ocupando los huecos
  const ordenReales = reales.slice().sort((a, b) => a.number - b.number);
  const jokers = comb.filter((t) => t.is_joker);
  // Si jokers ocupan los huecos entre números
  const nums = ordenReales.map((t) => t.number);
  const resultado = [];
  let jIdx = 0;
  for (let i = 0; i < nums.length; i++) {
    resultado.push(ordenReales[i]);
    if (i < nums.length - 1) {
      let gap = nums[i + 1] - nums[i] - 1;
      while (gap > 0 && jIdx < jokers.length) {
        resultado.push(jokers[jIdx++]);
        gap--;
      }
    }
  }
  // jokers restantes al final
  while (jIdx < jokers.length) resultado.push(jokers[jIdx++]);
  mesaLocal[idx] = resultado;
}

function puedeSustituirJoker(comb, posJoker, fichaReal) {
  if (fichaReal.is_joker) return false;
  // Probamos sustituir y validar
  const copia = comb.map((t) => ({ ...t }));
  copia[posJoker] = { ...fichaReal };
  const reglasActivas = (snapshotServidor && snapshotServidor.reglas) || {};
  return combinacionValida(copia, reglasActivas);
}

// ============ Reconciliación con snapshot del servidor ============
function reconciliarAtril(serverTiles) {
  // Preserva posiciones de los slots:
  //  - Quita del atril las fichas que ya no están en el servidor (deja null).
  //  - Para cada ficha nueva del servidor, la coloca en el primer slot libre.
  const idsServidor = new Set(serverTiles.map((t) => t.id));
  const idsLocales = new Set();
  for (let f = 0; f < atrilLocal.length; f++) {
    for (let c = 0; c < atrilLocal[f].length; c++) {
      const t = atrilLocal[f][c];
      if (t) {
        if (idsServidor.has(t.id)) idsLocales.add(t.id);
        else atrilLocal[f][c] = null;
      }
    }
  }
  for (const t of serverTiles) {
    if (!idsLocales.has(t.id)) {
      const libre = primerSlotLibre();
      atrilLocal[libre.fila][libre.col] = { ...t };
    }
  }
  compactarTail();
}

function atrilEstaVacio() {
  for (const fila of atrilLocal)
    for (const t of fila)
      if (t) return false;
  return true;
}

function aplicarSnapshot(snap) {
  snapshotServidor = snap;
  // Al recibir snapshot del servidor, los stacks de undo/redo se invalidan
  undoStack = [];
  redoStack = [];
  mesaLocal = snap.mesa.map((comb) => comb.map((t) => ({ ...t })));
  if (atrilEstaVacio()) {
    // Primera vez: reparto las 14 fichas en la fila superior (slots 0..13)
    atrilLocal = [Array(ATRIL_SLOTS_MIN).fill(null), Array(ATRIL_SLOTS_MIN).fill(null)];
    snap.tu_atril.forEach((t, i) => {
      if (i < ATRIL_SLOTS_MIN) atrilLocal[0][i] = { ...t };
      else atrilLocal[1][i - ATRIL_SLOTS_MIN] = { ...t };
    });
  } else {
    reconciliarAtril(snap.tu_atril);
  }
  miTurno = snap.turno === yo && !snap.ganador;
  ocultarEspera();
  render();
}

// ============ Cronómetro de partida ============
function actualizarCronometro() {
  if (!snapshotServidor || !snapshotServidor.iniciada) {
    if (infoTiempo) infoTiempo.textContent = "⏱ --:--";
    return;
  }
  const ahora = Date.now() / 1000;
  const transcurrido = Math.max(0, Math.floor(ahora - snapshotServidor.iniciada));
  const m = Math.floor(transcurrido / 60);
  const s = transcurrido % 60;
  if (infoTiempo) infoTiempo.textContent = `⏱ ${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
setInterval(actualizarCronometro, 1000);

// ============ Acciones ============
$("btn-fin-turno").addEventListener("click", () => {
  const mesa = mesaLocal.map((c) => c.map((t) => t.id));
  const atril = fichasEnAtril().map((t) => t.id);
  sock.enviar({ type: "proponer_jugada", mesa, atril });
});

$("btn-robar").addEventListener("click", () => {
  sock.enviar({ type: "robar" });
});

// ============ Undo / Redo stacks ============
let undoStack = [];
let redoStack = [];

function snapshotEstadoLocal() {
  return JSON.stringify({
    mesa: mesaLocal,
    atril: atrilLocal,
  });
}
function restaurarEstadoLocal(json) {
  const s = JSON.parse(json);
  mesaLocal = s.mesa.map((comb) => comb.map((t) => ({ ...t })));
  atrilLocal = s.atril.map((fila) => fila.map((t) => (t ? { ...t } : null)));
  render();
}
function guardarParaDeshacer() {
  undoStack.push(snapshotEstadoLocal());
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];  // un nuevo movimiento invalida el redo
}

$("btn-deshacer").addEventListener("click", () => {
  if (undoStack.length === 0) {
    // sin pasos locales: vuelvo al estado del servidor como antes
    if (snapshotServidor) {
      redoStack.push(snapshotEstadoLocal());
      mesaLocal = snapshotServidor.mesa.map((c) => c.map((t) => ({ ...t })));
      const idsMesa = new Set(mesaLocal.flat().map((t) => t.id));
      for (let f = 0; f < atrilLocal.length; f++) {
        for (let c = 0; c < atrilLocal[f].length; c++) {
          if (atrilLocal[f][c] && idsMesa.has(atrilLocal[f][c].id)) atrilLocal[f][c] = null;
        }
      }
      reconciliarAtril(snapshotServidor.tu_atril);
      render();
    }
    return;
  }
  redoStack.push(snapshotEstadoLocal());
  restaurarEstadoLocal(undoStack.pop());
});

$("btn-rehacer").addEventListener("click", () => {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotEstadoLocal());
  restaurarEstadoLocal(redoStack.pop());
});

$("btn-sonido").addEventListener("click", () => {
  sonidoActivo = !sonidoActivo;
  try { localStorage.setItem("rk_sonido", sonidoActivo ? "on" : "off"); } catch (_) {}
  actualizarBotonSonido();
  if (sonidoActivo) clicSonido();
});
actualizarBotonSonido();

function colocarPorFilas(fila0Tiles, fila1Tiles) {
  // Coloca dos arrays de tiles en las dos filas, slot 0..N, resto null.
  const ancho = Math.max(fila0Tiles.length, fila1Tiles.length, ATRIL_SLOTS_MIN);
  atrilLocal = [Array(ancho).fill(null), Array(ancho).fill(null)];
  fila0Tiles.forEach((t, i) => { atrilLocal[0][i] = t; });
  fila1Tiles.forEach((t, i) => { atrilLocal[1][i] = t; });
  compactarTail();
}

$("btn-ordenar").addEventListener("click", () => {
  guardarParaDeshacer();
  const cmp = (a, b) => {
    if (a.is_joker) return 1;
    if (b.is_joker) return -1;
    if (a.color !== b.color) return a.color.localeCompare(b.color);
    return a.number - b.number;
  };
  const todas = fichasEnAtril().sort(cmp);
  const mitad = Math.ceil(todas.length / 2);
  colocarPorFilas(todas.slice(0, mitad), todas.slice(mitad));
  render();
});

$("btn-ayuda").addEventListener("click", () => {
  guardarParaDeshacer();
  const ORDEN_COLORES = ["rojo", "azul", "negro", "amarillo"];
  const todas = fichasEnAtril();
  const grupos = ORDEN_COLORES.map((color) =>
    todas
      .filter((t) => !t.is_joker && t.color === color)
      .sort((a, b) => a.number - b.number)
  );
  const jokers = todas.filter((t) => t.is_joker);
  const bloques = [...grupos, jokers].filter((g) => g.length > 0);
  const total = bloques.reduce((acc, g) => acc + g.length, 0);
  const objetivo = total / 2;
  let acumulado = 0, mejorCorte = 0, mejorDiff = Infinity;
  for (let i = 0; i <= bloques.length; i++) {
    const diff = Math.abs(acumulado - objetivo);
    if (diff < mejorDiff) { mejorDiff = diff; mejorCorte = i; }
    if (i < bloques.length) acumulado += bloques[i].length;
  }
  colocarPorFilas(bloques.slice(0, mejorCorte).flat(), bloques.slice(mejorCorte).flat());
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
