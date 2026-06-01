// comm.js — WebRTC (vídeo + audio P2P) + chat de texto.
// Depende de window.sock (RKSocket) y window.codigo, window.nombre definidos en game.js.

(function () {
  const $ = (id) => document.getElementById(id);

  const panel = $("panel-comm");
  const btnChat = $("btn-chat");
  const btnCamara = $("btn-camara");
  const btnMic = $("btn-mic");
  const videoLocal = $("video-local");
  const videoRemoto = $("video-remoto");
  const videoTileRemoto = videoRemoto.parentElement;
  const labelRemoto = $("video-remoto-label");
  const chatMensajes = $("chat-mensajes");
  const chatForm = $("chat-form");
  const chatInput = $("chat-input");

  // El panel siempre empieza cerrado al entrar a la partida.
  // El localStorage solo recuerda la preferencia para dentro de la misma sesión.
  let panelVisible = false;
  panel.classList.add("hidden");

  btnChat.addEventListener("click", () => {
    panelVisible = !panelVisible;
    panel.classList.toggle("hidden", !panelVisible);
    try { localStorage.setItem("rk_panel_comm", panelVisible ? "on" : "off"); } catch (_) {}
  });

  function abrirPanel() {
    if (panelVisible) return;
    panelVisible = true;
    panel.classList.remove("hidden");
    try { localStorage.setItem("rk_panel_comm", "on"); } catch (_) {}
  }

  // ====== Arrastrar el panel ======
  (function habilitarArrastre() {
    const handle = $("panel-comm-handle");
    if (!handle) return;

    // Restaurar posición guardada
    try {
      const pos = JSON.parse(localStorage.getItem("rk_panel_pos") || "null");
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        panel.style.left = pos.x + "px";
        panel.style.top = pos.y + "px";
        panel.style.right = "auto";
      }
    } catch (_) {}

    let dragging = false, offX = 0, offY = 0;

    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      const r = panel.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      panel.style.right = "auto";
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      let x = e.clientX - offX;
      let y = e.clientY - offY;
      x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - 40));
      panel.style.left = x + "px";
      panel.style.top = y + "px";
    });
    const finArrastre = () => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem("rk_panel_pos",
          JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop }));
      } catch (_) {}
    };
    handle.addEventListener("pointerup", finArrastre);
    handle.addEventListener("pointercancel", finArrastre);
  })();

  // ====== WebRTC ======
  const ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    ],
  };

  let pc = null;          // RTCPeerConnection
  let localStream = null; // MediaStream
  let camOn = false;
  let micOn = false;

  // Perfect negotiation state
  let makingOffer = false;
  let ignoreOffer = false;
  let polite = null; // se determina al saber el nombre del rival
  let pendingIce = []; // ICE candidates llegados antes del setRemoteDescription

  function asegurarRol(remoteName) {
    if (polite !== null || !remoteName) return;
    polite = String(window.nombre || "").toLowerCase() < String(remoteName).toLowerCase();
  }

  function esperarSock() {
    return new Promise((res) => {
      const intent = () => {
        if (window.sock && window.sock.ws && window.sock.ws.readyState === WebSocket.OPEN) res();
        else setTimeout(intent, 200);
      };
      intent();
    });
  }

  function actualizarBotonesAV() {
    btnCamara.textContent = camOn ? "📷 ON" : "📷 OFF";
    btnCamara.classList.toggle("activo", camOn);
    btnMic.textContent = micOn ? "🎤 ON" : "🎤 OFF";
    btnMic.classList.toggle("activo", micOn);
  }

  async function obtenerLocalStream(necesitaVideo, necesitaAudio) {
    if (localStream) {
      // Ajustar tracks existentes
      localStream.getVideoTracks().forEach(t => t.enabled = necesitaVideo);
      localStream.getAudioTracks().forEach(t => t.enabled = necesitaAudio);

      // Si necesitamos audio pero el stream no tiene tracks de audio, pedirlo ahora
      if (necesitaAudio && localStream.getAudioTracks().length === 0) {
        const extra = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        extra.getAudioTracks().forEach(t => localStream.addTrack(t));
      }
      // Si necesitamos vídeo pero el stream no tiene tracks de vídeo, pedirlo ahora
      if (necesitaVideo && localStream.getVideoTracks().length === 0) {
        const extra = await navigator.mediaDevices.getUserMedia(
          { video: { width: 320, height: 240, facingMode: "user" }, audio: false });
        extra.getVideoTracks().forEach(t => localStream.addTrack(t));
        videoLocal.srcObject = localStream;
      }
      return localStream;
    }
    const constraints = {
      video: necesitaVideo ? { width: 320, height: 240, facingMode: "user" } : false,
      audio: necesitaAudio,
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoLocal.srcObject = localStream;
    return localStream;
  }

  function crearPC() {
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = (e) => {
      if (e.candidate) sock.enviar({ type: "video_ice", candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      videoRemoto.srcObject = e.streams[0];
      videoTileRemoto.classList.add("con-stream");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        videoTileRemoto.classList.remove("con-stream");
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        sock.enviar({ type: "video_offer", sdp: pc.localDescription });
      } catch (e) {
        console.warn("[comm] negotiationneeded error:", e);
      } finally {
        makingOffer = false;
      }
    };
    return pc;
  }

  function vincularTracks() {
    if (!pc || !localStream) return;
    const senders = pc.getSenders();
    localStream.getTracks().forEach((track) => {
      const ya = senders.find(s => s.track && s.track.kind === track.kind);
      if (ya) ya.replaceTrack(track);
      else pc.addTrack(track, localStream);
    });
  }

  async function activarCamara() {
    try {
      abrirPanel();
      await obtenerLocalStream(true, micOn);
      camOn = true;
      crearPC();
      vincularTracks(); // dispara onnegotiationneeded
    } catch (e) {
      mostrarToastLocal("No se pudo acceder a la cámara: " + e.message);
      camOn = false;
    }
    actualizarBotonesAV();
  }

  async function desactivarCamara() {
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => { t.enabled = false; t.stop(); });
    }
    videoLocal.srcObject = null;
    camOn = false;
    actualizarBotonesAV();
    if (pc) {
      pc.getSenders().forEach(s => { if (s.track && s.track.kind === "video") pc.removeTrack(s); });
      // onnegotiationneeded se dispara solo
    }
  }

  async function activarMic() {
    try {
      abrirPanel();
      await obtenerLocalStream(camOn, true);
      micOn = true;
      crearPC();
      vincularTracks(); // dispara onnegotiationneeded
    } catch (e) {
      mostrarToastLocal("No se pudo acceder al micrófono: " + e.message);
      micOn = false;
    }
    actualizarBotonesAV();
  }

  async function desactivarMic() {
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => { t.enabled = false; t.stop(); });
    }
    micOn = false;
    actualizarBotonesAV();
    if (pc) {
      pc.getSenders().forEach(s => { if (s.track && s.track.kind === "audio") pc.removeTrack(s); });
    }
  }

  btnCamara.addEventListener("click", () => camOn ? desactivarCamara() : activarCamara());
  btnMic.addEventListener("click", () => micOn ? desactivarMic() : activarMic());

  // ====== Mensajes desde el servidor ======
  function inyectarHandlers() {
    if (!window.sock || !sock.handlers) return setTimeout(inyectarHandlers, 200);
    sock.handlers.video_offer = async (data) => {
      asegurarRol(data.from);
      crearPC();
      // NO añadir tracks aquí: dispararía onnegotiationneeded en mitad de la
      // negociación entrante. Los tracks se añaden solo en activarCamara/Mic.
      const offerCollision =
        data.sdp && data.sdp.type === "offer" &&
        (makingOffer || pc.signalingState !== "stable");
      ignoreOffer = !polite && offerCollision;
      if (ignoreOffer) {
        console.warn("[comm] ignorando offer (impolite, collision)");
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        // drena ICE pendientes
        for (const c of pendingIce) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
        }
        pendingIce = [];
        await pc.setLocalDescription();
        sock.enviar({ type: "video_answer", sdp: pc.localDescription });
      } catch (e) {
        console.warn("[comm] error procesando offer:", e);
      }
    };
    sock.handlers.video_answer = async (data) => {
      asegurarRol(data.from);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of pendingIce) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
        }
        pendingIce = [];
      } catch (e) {
        console.warn("[comm] error procesando answer:", e);
      }
    };
    sock.handlers.video_ice = async (data) => {
      asegurarRol(data.from);
      if (!data.candidate) return;
      if (!pc || !pc.remoteDescription) {
        pendingIce.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        if (!ignoreOffer) console.warn("[comm] addIceCandidate fail:", e);
      }
    };
    sock.handlers.chat = (data) => {
      añadirMensajeChat(data.from || "Rival", data.texto || "", false);
      if (data.from) labelRemoto.textContent = data.from;
    };
  }
  inyectarHandlers();

  // ====== Chat ======
  function añadirMensajeChat(autor, texto, propio) {
    const div = document.createElement("div");
    div.className = "chat-msg " + (propio ? "propio" : "rival");
    const span = document.createElement("span");
    span.className = "autor";
    span.textContent = autor;
    const t = document.createElement("div");
    t.textContent = texto;
    div.appendChild(span);
    div.appendChild(t);
    chatMensajes.appendChild(div);
    chatMensajes.scrollTop = chatMensajes.scrollHeight;
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (!txt) return;
    if (window.sock && sock.enviar) {
      const ok = sock.enviar({ type: "chat", texto: txt });
      if (ok) {
        añadirMensajeChat("Tú", txt, true);
        chatInput.value = "";
      }
    }
  });

  function mostrarToastLocal(msg) {
    if (typeof mostrarToast === "function") mostrarToast(msg, "error");
    else alert(msg);
  }

  actualizarBotonesAV();
})();
