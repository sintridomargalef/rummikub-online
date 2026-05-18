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
