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

  let panelVisible = (() => {
    try { return localStorage.getItem("rk_panel_comm") !== "off"; } catch (_) { return true; }
  })();
  panel.classList.toggle("hidden", !panelVisible);

  btnChat.addEventListener("click", () => {
    panelVisible = !panelVisible;
    panel.classList.toggle("hidden", !panelVisible);
    try { localStorage.setItem("rk_panel_comm", panelVisible ? "on" : "off"); } catch (_) {}
  });

  // ====== WebRTC ======
  const ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  let pc = null;          // RTCPeerConnection
  let localStream = null; // MediaStream
  let camOn = false;
  let micOn = false;

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

  async function negociar() {
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sock.enviar({ type: "video_offer", sdp: pc.localDescription });
  }

  async function activarCamara() {
    try {
      await obtenerLocalStream(true, micOn);
      camOn = true;
      crearPC();
      vincularTracks();
      await negociar();
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
      // quitamos las pistas de vídeo del peer
      pc.getSenders().forEach(s => { if (s.track && s.track.kind === "video") pc.removeTrack(s); });
      // renegociamos para informar al rival
      try { await negociar(); } catch (_) {}
    }
  }

  async function activarMic() {
    try {
      await obtenerLocalStream(camOn, true);
      micOn = true;
      crearPC();
      vincularTracks();
      await negociar();
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
      try { await negociar(); } catch (_) {}
    }
  }

  btnCamara.addEventListener("click", () => camOn ? desactivarCamara() : activarCamara());
  btnMic.addEventListener("click", () => micOn ? desactivarMic() : activarMic());

  // ====== Mensajes desde el servidor ======
  function inyectarHandlers() {
    if (!window.sock || !sock.handlers) return setTimeout(inyectarHandlers, 200);
    sock.handlers.video_offer = async (data) => {
      crearPC();
      // Si aún no tenemos stream local, abrir mic/cam según hayamos activado
      if (!localStream && (camOn || micOn)) await obtenerLocalStream(camOn, micOn);
      vincularTracks();
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sock.enviar({ type: "video_answer", sdp: pc.localDescription });
    };
    sock.handlers.video_answer = async (data) => {
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch (e) {}
    };
    sock.handlers.video_ice = async (data) => {
      if (!pc || !data.candidate) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (_) {}
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
