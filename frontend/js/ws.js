// Cliente WebSocket simple con reconexión básica.
class RKSocket {
  constructor(codigo, nombre, handlers) {
    this.codigo = codigo;
    this.nombre = nombre;
    this.handlers = handlers;
    this.ws = null;
    this.intentos = 0;
    this.cerradoManual = false;
  }

  conectar() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/${this.codigo}?nombre=${encodeURIComponent(this.nombre)}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.intentos = 0;
      this.handlers.onOpen && this.handlers.onOpen();
    };
    this.ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      const h = this.handlers[data.type];
      if (h) h(data);
    };
    this.ws.onclose = () => {
      this.handlers.onClose && this.handlers.onClose();
      if (this.cerradoManual) return;
      const espera = Math.min(2000 + this.intentos * 1000, 8000);
      this.intentos++;
      setTimeout(() => this.conectar(), espera);
    };
    this.ws.onerror = () => {};
  }

  enviar(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  cerrar() {
    this.cerradoManual = true;
    if (this.ws) this.ws.close();
  }
}
