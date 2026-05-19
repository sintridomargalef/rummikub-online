import tkinter as tk
from tkinter import font
import threading
import webbrowser
import subprocess
import time
import os
import re

PYTHON = r"C:\Users\sintr\AppData\Local\Programs\Python\Python312\python.exe"
WORKDIR = r"C:\rummikub-online"

BG = "#0a0014"
BG2 = "#14002a"
BG3 = "#1a002e"
BG_LOG = "#0d0030"
FG = "#00f0ff"
MAGENTA = "#ff00ff"
GREEN = "#00ff88"
RED = "#ff003c"
GRAY = "#666"
CYAN = "#00f0ff"

SERVERS = [
    {"name": "GAME SERVER", "port": 8443, "app": "backend.main:app",
     "log": "server_8443.log", "ssl": True},
    {"name": "ADMIN SERVER", "port": 8080, "app": "backend.main:admin_app",
     "log": "admin.log", "ssl": False},
]
SSL_KEY = "certs/key.pem"
SSL_CERT = "certs/cert.pem"


class RummikubControl:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Rummikub Control — LOCAL")
        self.root.geometry("680x620")
        self.root.configure(bg=BG)
        self.root.resizable(False, False)

        self.f_tit = font.Font(family="Courier New", size=13, weight="bold")
        self.f_sub = font.Font(family="Courier New", size=11, weight="bold")
        self.f_btn = font.Font(family="Courier New", size=10, weight="bold")
        self.f_log = font.Font(family="Consolas", size=9)
        self.f_mono = font.Font(family="Courier New", size=9)

        tk.Label(self.root, text="── RUMMIKUB CONTROL [LOCAL] ──",
                 font=self.f_tit, fg=MAGENTA, bg=BG).pack(pady=(10, 2))

        self.lbl_con = tk.Label(self.root, text="●  Local",
                                font=self.f_sub, fg=GREEN, bg=BG)
        self.lbl_con.pack()

        sep = tk.Frame(self.root, height=2, bg="#222")
        sep.pack(fill=tk.X, padx=10, pady=6)

        self.sections = []
        for srv in SERVERS:
            sec = self._build_server_section(srv)
            self.sections.append(sec)
            sep2 = tk.Frame(self.root, height=2, bg="#222")
            sep2.pack(fill=tk.X, padx=10, pady=4)

        self._build_bottom()

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._running = True
        self._refresh()

    def _build_server_section(self, srv):
        data = {"srv": srv}
        f = tk.Frame(self.root, bg=BG)
        f.pack(fill=tk.X, padx=12, pady=(2, 0))

        hdr = tk.Frame(f, bg=BG)
        hdr.pack(fill=tk.X)
        tk.Label(hdr, text=f"▸ {srv['name']}  :{srv['port']}",
                 font=self.f_sub, fg=MAGENTA, bg=BG).pack(side=tk.LEFT)

        lbl_status = tk.Label(hdr, text="●  --", font=self.f_mono, fg=GRAY, bg=BG)
        lbl_status.pack(side=tk.RIGHT)
        data["lbl_status"] = lbl_status

        pid_row = tk.Frame(f, bg=BG)
        pid_row.pack(fill=tk.X)
        lbl_pid = tk.Label(pid_row, text="", font=self.f_mono, fg=GRAY, bg=BG)
        lbl_pid.pack(anchor=tk.W)
        data["lbl_pid"] = lbl_pid

        # Banner GRANDE de estado actual (verde o rojo según RUN/STOP)
        banner_estado = tk.Label(f, text="🔴  APAGADO",
                                 font=("Courier New", 14, "bold"),
                                 fg="#fff", bg=RED, padx=12, pady=4)
        banner_estado.pack(fill=tk.X, pady=(2, 2))
        data["banner_estado"] = banner_estado

        btn_row = tk.Frame(f, bg=BG)
        btn_row.pack(fill=tk.X, pady=(3, 2))
        btn_start = tk.Button(btn_row, text="▸ INICIAR", font=self.f_btn,
                              fg=GREEN, bg=BG3, activebackground="#2a004e",
                              bd=2, relief=tk.FLAT, width=14, cursor="hand2",
                              command=lambda s=srv: self._start_server(s))
        btn_start.pack(side=tk.LEFT, padx=(0, 4))
        btn_stop = tk.Button(btn_row, text="■ DETENER", font=self.f_btn,
                             fg=RED, bg=BG3, activebackground="#2a004e",
                             bd=2, relief=tk.FLAT, width=14, cursor="hand2",
                             command=lambda s=srv: self._stop_server(s))
        btn_stop.pack(side=tk.LEFT)
        data["btn_start"] = btn_start
        data["btn_stop"] = btn_stop

        log_frame = tk.Frame(f, bg="#222", bd=1, relief=tk.SUNKEN)
        log_frame.pack(fill=tk.X, pady=(2, 4))
        txt_log = tk.Text(log_frame, height=6, width=90,
                          font=self.f_log, bg=BG_LOG, fg=CYAN,
                          insertbackground=CYAN, bd=0,
                          highlightthickness=0, state=tk.DISABLED)
        txt_log.pack(fill=tk.X, padx=1, pady=1)
        data["txt_log"] = txt_log

        return data

    def _build_bottom(self):
        bottom = tk.Frame(self.root, bg=BG)
        bottom.pack(fill=tk.X, padx=12, pady=(2, 8))

        btn_admin = tk.Button(bottom, text="🌐  ADMIN :8080", font=self.f_sub,
                              fg=MAGENTA, bg=BG3, activebackground="#2a004e",
                              bd=2, relief=tk.RAISED, cursor="hand2",
                              command=lambda: webbrowser.open("http://127.0.0.1:8080"))
        btn_admin.pack(side=tk.LEFT, padx=(0, 6))

        self.lbl_auto = tk.Label(bottom, text="Auto [●]", font=self.f_mono, fg=GREEN, bg=BG)
        self.lbl_auto.pack(side=tk.LEFT, padx=(0, 6))

        btn_refresh = tk.Button(bottom, text="⟳ REFRESCAR", font=self.f_btn,
                                fg=FG, bg=BG3, activebackground="#2a004e",
                                bd=2, relief=tk.RAISED, cursor="hand2",
                                command=self._refresh_now)
        btn_refresh.pack(side=tk.LEFT, padx=(0, 6))

        btn_salir = tk.Button(bottom, text="SALIR", font=self.f_sub,
                              fg="#fff", bg=BG3, activebackground="#2a004e",
                              bd=2, relief=tk.RAISED, width=12, cursor="hand2",
                              command=self._on_close)
        btn_salir.pack(side=tk.RIGHT)

    # ────── Local subprocess helpers ──────
    def _cmd(self, cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW, timeout=8)
            return (r.stdout or r.stderr).strip()
        except Exception:
            return ""

    def _ps(self, script):
        return self._cmd(["powershell", "-NoProfile", "-Command", script])

    # ────── Auto refresh ──────
    def _refresh(self):
        if not self._running:
            return
        self._refresh_status()
        self._refresh_logs()
        self.root.after(3000, self._refresh)

    def _refresh_now(self):
        threading.Thread(target=lambda: [self._refresh_status(), self._refresh_logs()], daemon=True).start()

    # ────── Status / Log ──────
    def _refresh_status(self):
        for sec in self.sections:
            srv = sec["srv"]
            pid = self._get_pid(srv["port"])
            sec["lbl_status"].config(text="●  RUN" if pid else "●  STOP",
                                     fg=GREEN if pid else RED)
            sec["lbl_pid"].config(text=f"PID {pid}" if pid else "", fg=GREEN if pid else GRAY)
            # Banner GRANDE de estado actual
            if pid:
                sec["banner_estado"].config(
                    text=f"🟢  EN MARCHA · PID {pid}",
                    bg=GREEN, fg="#000",
                )
                # INICIAR resaltado en verde brillante (FLAT con bg sólido)
                sec["btn_start"].config(
                    text="▶ INICIADO",
                    bg=GREEN, fg="#000",
                    relief=tk.FLAT, bd=0,
                    activebackground=GREEN,
                    state=tk.DISABLED, disabledforeground="#000",
                )
                sec["btn_stop"].config(
                    text="■ DETENER",
                    bg=BG3, fg=RED,
                    relief=tk.FLAT, bd=2,
                    state=tk.NORMAL,
                )
            else:
                sec["banner_estado"].config(
                    text="🔴  APAGADO",
                    bg=RED, fg="#fff",
                )
                sec["btn_start"].config(
                    text="▸ INICIAR",
                    bg=BG3, fg=GREEN,
                    relief=tk.FLAT, bd=2,
                    state=tk.NORMAL,
                )
                sec["btn_stop"].config(
                    text="■ DETENIDO",
                    bg=RED, fg="#fff",
                    relief=tk.FLAT, bd=0,
                    activebackground=RED,
                    state=tk.DISABLED, disabledforeground="#fff",
                )

    def _refresh_logs(self):
        for sec in self.sections:
            srv = sec["srv"]
            txt = sec["txt_log"]
            log_text = self._get_log(srv["log"])
            self.root.after(0, lambda t=txt, lt=log_text: self._do_set_log(t, lt))

    def _do_set_log(self, txt, text):
        txt.config(state=tk.NORMAL)
        txt.delete("1.0", tk.END)
        txt.insert("1.0", text if text else "(log empty or unavailable)")
        txt.see(tk.END)
        txt.config(state=tk.DISABLED)

    # ────── Commands ──────
    def _get_pid(self, port):
        # Usamos shell=True para que el pipe | funcione. Sin shell, las pipes
        # se pasan como argumentos literales a netstat y el comando falla.
        try:
            r = subprocess.run(
                f'netstat -ano | findstr LISTENING | findstr ":{port} "',
                capture_output=True, text=True, shell=True,
                creationflags=subprocess.CREATE_NO_WINDOW, timeout=8,
            )
            raw = (r.stdout or "").strip()
        except Exception:
            return None
        if not raw:
            return None
        for line in raw.split("\n"):
            parts = line.strip().split()
            if len(parts) >= 5:
                # parts: [proto, local_addr, foreign_addr, state, pid]
                # Nos aseguramos de que la dirección local termina en :port
                if parts[1].endswith(f":{port}"):
                    try:
                        return int(parts[-1])
                    except ValueError:
                        continue
        return None

    def _get_log(self, logfile):
        path = os.path.join(WORKDIR, logfile)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            return "".join(lines[-50:]).strip()
        except Exception:
            return "(log empty or unavailable)"

    def _start_server(self, srv):
        def run():
            pid = self._get_pid(srv["port"])
            if pid:
                self._log(srv, f"Already running (PID {pid})")
                return

            logpath = os.path.join(WORKDIR, srv["log"])
            env = os.environ.copy()
            env["PYTHONPATH"] = WORKDIR
            flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
            cmd = [PYTHON, "-m", "uvicorn", srv["app"],
                   "--host", "0.0.0.0", "--port", str(srv["port"])]
            if srv.get("ssl"):
                key_path = os.path.join(WORKDIR, SSL_KEY)
                cert_path = os.path.join(WORKDIR, SSL_CERT)
                if os.path.exists(key_path) and os.path.exists(cert_path):
                    cmd += ["--ssl-keyfile", key_path, "--ssl-certfile", cert_path]
                else:
                    self._log(srv, f"WARN: certs no encontrados en {key_path} / {cert_path}, arranco HTTP")
            p = subprocess.Popen(
                cmd,
                stdout=open(logpath, "w"), stderr=subprocess.STDOUT,
                cwd=WORKDIR, env=env, creationflags=flags
            )
            time.sleep(2)
            if p.poll() is None:
                self._log(srv, f"Started PID {p.pid}")
            else:
                self._log(srv, "Start failed (check log)")
        threading.Thread(target=run, daemon=True).start()

    def _stop_server(self, srv):
        def run():
            pid = self._get_pid(srv["port"])
            if not pid:
                self._log(srv, "Not running")
                return
            self._cmd(f"taskkill /PID {pid} /F".split())
            time.sleep(1)
            if not self._get_pid(srv["port"]):
                self._log(srv, f"Stopped PID {pid}")
            else:
                self._log(srv, f"Failed to stop PID {pid}")
        threading.Thread(target=run, daemon=True).start()

    def _log(self, srv, msg):
        for sec in self.sections:
            if sec["srv"]["port"] == srv["port"]:
                txt = sec["txt_log"]
                def do_append():
                    txt.config(state=tk.NORMAL)
                    txt.insert(tk.END, f"> {msg}\n")
                    txt.see(tk.END)
                    txt.config(state=tk.DISABLED)
                self.root.after(0, do_append)
                break

    # ────── Cleanup ──────
    def _on_close(self):
        self._running = False
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    RummikubControl().run()
