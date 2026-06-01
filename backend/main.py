"""Servidor FastAPI: REST mínimo para crear sala + WebSocket de juego."""
from __future__ import annotations

import asyncio
import json
import os
import random
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .game.state import GameState
from .game.rules import aplicar_jugada, robar_y_pasar
from .game.board import REGLAS_POR_DEFECTO
from .rooms import gestor
from .ai_solver import RummikubSolver
from . import stats
from . import bot_log
from . import notify_telegram

NOMBRE_IA = "🤖 IA"
MEMORIA_PATH = Path(__file__).resolve().parent.parent / "ai_memory.json"


class AiMemory:
    def __init__(self):
        self._datos: dict = {"partidas": 0, "ganadas": 0, "perdidas": 0, "rachas": []}
        self._cargar()

    def _cargar(self):
        try:
            self._datos = json.loads(MEMORIA_PATH.read_text(encoding="utf-8"))
        except Exception:
            self._datos = {"partidas": 0, "ganadas": 0, "perdidas": 0, "rachas": []}

    def _guardar(self):
        MEMORIA_PATH.write_text(json.dumps(self._datos, indent=2), encoding="utf-8")

    def registrar_resultado(self, ganada: bool):
        self._datos["partidas"] += 1
        if ganada:
            self._datos["ganadas"] += 1
        else:
            self._datos["perdidas"] += 1
        self._guardar()

    @property
    def win_rate(self) -> float:
        if self._datos["partidas"] == 0:
            return 0.5
        return self._datos["ganadas"] / self._datos["partidas"]


memoria = AiMemory()

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

INICIO_SERVER = time.time()

# Hash del commit actual para cache-busting de estáticos
import subprocess as _sp
try:
    _VER = _sp.run(["git", "rev-parse", "--short", "HEAD"],
                   capture_output=True, text=True, cwd=str(ROOT), timeout=3).stdout.strip()
    if not _VER:
        _VER = str(int(INICIO_SERVER))
except Exception:
    _VER = str(int(INICIO_SERVER))

app = FastAPI(title="Rummikub Online")


# ===== Anti-bot middleware =====
# Lista de fragmentos de URL típicos de bots / scanners (case-insensitive).
# Si la URL coincide, devolvemos 403 sin tocar el resto del router.
PATHS_SOSPECHOSOS = (
    "autodiscover", "wp-", "wordpress", ".env", ".git", ".aws",
    "phpmyadmin", "phpadmin", "cgi-bin", "/owa/", "/ecp/", "manager/html",
    "xmlrpc.php", "boaform", "hudson", "jenkins", "solr", "actuator",
    "/.well-known/security.txt", "wp-config", "wp-admin",
    "vendor/phpunit", "shell.php", "eval-stdin", "thinkphp",
    "fckeditor", "tinymce", "fileman", "/druid/", "/console/",
)

# Conteo simple de IPs sospechosas para banear las más insistentes (en memoria).
_bot_hits: dict[str, int] = {}
_bot_baneadas: set[str] = set()


def _es_ip_privada(ip: str) -> bool:
    """IPs de la LAN. El router Movistar presenta TODO el tráfico de internet
    como 192.168.1.1 (SNAT), así que banear una IP privada bloquearía a todos
    los jugadores. Por eso nunca se banean."""
    return (
        ip.startswith("127.")
        or ip.startswith("10.")
        or ip.startswith("192.168.")
        or ip == "::1"
        or any(ip.startswith(f"172.{n}.") for n in range(16, 32))
    )


@app.middleware("http")
async def filtrar_scanners(request: Request, call_next):
    path = request.url.path.lower()
    ip = request.client.host if request.client else "?"
    if ip in _bot_baneadas:
        return Response(status_code=403)
    for p in PATHS_SOSPECHOSOS:
        if p in path:
            _bot_hits[ip] = _bot_hits.get(ip, 0) + 1
            # Solo se banean IPs públicas reales: banear una privada
            # tumbaría a todos los jugadores de internet (ver _es_ip_privada).
            if _bot_hits[ip] >= 3 and not _es_ip_privada(ip):
                _bot_baneadas.add(ip)
            ua = request.headers.get("user-agent", "")
            try:
                bot_log.registrar(ip, request.url.path, ua)
            except Exception:
                pass
            print(f"[BOT BLOCKED] {ip} -> {request.url.path}", flush=True)
            return Response(status_code=403)
    return await call_next(request)
admin_app = FastAPI(title="Rummikub Admin")


@app.post("/api/sala")
async def crear_sala(request: Request):
    sala = gestor.crear()
    try:
        body = await request.json()
    except Exception:
        body = {}
    reglas_in = body.get("reglas", {}) if isinstance(body, dict) else {}
    sala.reglas = {}
    for k, v in REGLAS_POR_DEFECTO.items():
        val = reglas_in.get(k, v)
        if isinstance(v, bool):
            val = bool(val)
        elif isinstance(v, int):
            val = int(val)
        sala.reglas[k] = val
    return {"codigo": sala.codigo, "reglas": sala.reglas}


@app.get("/api/version")
async def api_version():
    """Devuelve el hash corto del commit + fecha. Para mostrar versión en el lobby."""
    import subprocess
    info = {"commit": "?", "fecha": "?", "label": "rummikub"}
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=str(ROOT), timeout=3,
        ).stdout.strip()
        fecha = subprocess.run(
            ["git", "log", "-1", "--format=%cd", "--date=format:%Y-%m-%d"],
            capture_output=True, text=True, cwd=str(ROOT), timeout=3,
        ).stdout.strip()
        if commit: info["commit"] = commit
        if fecha:  info["fecha"]  = fecha
    except Exception:
        pass
    return info


@app.get("/api/sala/{codigo}")
async def info_sala(codigo: str):
    sala = gestor.obtener(codigo)
    if not sala:
        raise HTTPException(404, "Sala no encontrada")
    return {
        "codigo": sala.codigo,
        "jugadores": sala.jugadores,
        "partida_iniciada": sala.estado is not None,
        "reglas": sala.reglas,
    }


async def _ejecutar_turno_ia(sala) -> None:
    if not sala.estado:
        return
    if sala.estado.ganador:
        return
    if sala.estado.turno != NOMBRE_IA:
        return
    await asyncio.sleep(1.5)
    if not sala.estado or sala.estado.ganador:
        return
    if sala.estado.turno != NOMBRE_IA:
        return

    snapshot = sala.estado.snapshot_para(NOMBRE_IA)
    solver = RummikubSolver(reglas=sala.estado.reglas)
    resultado = solver.buscar_jugada(snapshot, NOMBRE_IA)

    if resultado:
        mesa_ids, atril_ids = resultado
        res = aplicar_jugada(sala.estado, NOMBRE_IA, mesa_ids, atril_ids)
        if not res.ok:
            resultado = None

    if not resultado:
        robar_y_pasar(sala.estado, NOMBRE_IA)

    await _broadcast_estado(sala)

    if sala.estado and sala.estado.ganador:
        sala.finalizada = time.time()
        memoria.registrar_resultado(sala.estado.ganador == NOMBRE_IA)
        try:
            stats.registrar_partida(sala.jugadores, sala.estado.ganador, contra_ia=True)
        except Exception:
            pass
        for n, ws in list(sala.sockets.items()):
            if ws is None:
                continue
            try:
                await ws.send_json({"type": "fin_partida", "ganador": sala.estado.ganador})
            except Exception:
                pass
        notify_telegram.enviar(
            f"🏁 Partida {sala.codigo} terminada\n"
            f"Ganador: {sala.estado.ganador}\n"
            f"Jugadores: {', '.join(sala.jugadores)}"
        )
    elif sala.estado:
        asyncio.create_task(_ejecutar_turno_ia(sala))


async def _broadcast_estado(sala) -> None:
    if not sala.estado:
        return
    for nombre, ws in list(sala.sockets.items()):
        if ws is None:
            continue
        try:
            await ws.send_json({
                "type": "estado",
                "snapshot": sala.estado.snapshot_para(nombre),
            })
        except Exception:
            pass


async def _enviar_lobby(sala) -> None:
    payload = {
        "type": "lobby",
        "jugadores": sala.jugadores,
        "esperando": len(sala.jugadores) < 2,
    }
    for ws in list(sala.sockets.values()):
        try:
            await ws.send_json(payload)
        except Exception:
            pass


@app.websocket("/ws/{codigo}")
async def ws_juego(websocket: WebSocket, codigo: str, nombre: str):
    await websocket.accept()
    sala = gestor.obtener(codigo)
    if not sala:
        await websocket.send_json({"type": "error", "msg": "Sala no existe"})
        await websocket.close()
        return

    # registrar jugador
    if nombre in sala.sockets:
        # ya conectado bajo ese nombre — rechazar duplicado
        await websocket.send_json({"type": "error", "msg": "Ese nombre ya está conectado"})
        await websocket.close()
        return

    es_jugador_nuevo = nombre not in sala.jugadores

    if nombre not in sala.jugadores:
        if len(sala.jugadores) >= 2:
            await websocket.send_json({"type": "error", "msg": "Sala llena"})
            await websocket.close()
            return
        sala.jugadores.append(nombre)

    # si es contra IA, añadir IA y barajar orden
    if sala.reglas.get("contra_ia") and NOMBRE_IA not in sala.jugadores:
        sala.jugadores.append(NOMBRE_IA)
        random.shuffle(sala.jugadores)

    sala.sockets[nombre] = websocket
    if sala.reglas.get("contra_ia"):
        sala.sockets[NOMBRE_IA] = None

    # si ya hay 2 jugadores y no se ha iniciado partida, iniciarla
    if len(sala.jugadores) == 2 and sala.estado is None:
        ahora = time.time()
        sala.estado = GameState.nueva_partida(sala.jugadores, reglas=sala.reglas, iniciada=ahora)
        sala.iniciada = ahora

    sala.tocar()
    if es_jugador_nuevo:
        notify_telegram.enviar(
            f"📥 {nombre} entró a la sala {codigo}\n"
            f"Jugadores: {', '.join(sala.jugadores)}"
        )
    if sala.estado is None:
        await _enviar_lobby(sala)
    else:
        await _broadcast_estado(sala)
        if sala.reglas.get("contra_ia") and not sala.estado.ganador:
            asyncio.create_task(_ejecutar_turno_ia(sala))

    try:
        while True:
            data = await websocket.receive_json()
            tipo = data.get("type")
            sala.tocar()

            if sala.estado is None:
                await websocket.send_json({"type": "error", "msg": "Esperando al segundo jugador"})
                continue

            if tipo == "proponer_jugada":
                nueva_mesa = data.get("mesa", [])
                nuevo_atril = data.get("atril", [])
                res = aplicar_jugada(sala.estado, nombre, nueva_mesa, nuevo_atril)
                if not res.ok:
                    await websocket.send_json({"type": "error", "msg": res.error})
                    # reenviar estado canónico al solicitante para que restaure
                    await websocket.send_json({
                        "type": "estado",
                        "snapshot": sala.estado.snapshot_para(nombre),
                    })
                else:
                    await _broadcast_estado(sala)
                    if sala.estado.ganador:
                        sala.finalizada = time.time()
                        if sala.reglas.get("contra_ia"):
                            memoria.registrar_resultado(sala.estado.ganador == NOMBRE_IA)
                        try:
                            stats.registrar_partida(sala.jugadores, sala.estado.ganador,
                                                    contra_ia=bool(sala.reglas.get("contra_ia")))
                        except Exception:
                            pass
                        for n, ws in list(sala.sockets.items()):
                            try:
                                await ws.send_json({"type": "fin_partida", "ganador": sala.estado.ganador})
                            except Exception:
                                pass
                        notify_telegram.enviar(
                            f"🏁 Partida {codigo} terminada\n"
                            f"Ganador: {sala.estado.ganador}\n"
                            f"Jugadores: {', '.join(sala.jugadores)}"
                        )
                    elif sala.reglas.get("contra_ia"):
                        asyncio.create_task(_ejecutar_turno_ia(sala))

            elif tipo == "robar":
                res = robar_y_pasar(sala.estado, nombre)
                if not res.ok:
                    await websocket.send_json({"type": "error", "msg": res.error})
                else:
                    await _broadcast_estado(sala)
                    if sala.reglas.get("contra_ia") and not sala.estado.ganador:
                        asyncio.create_task(_ejecutar_turno_ia(sala))

            elif tipo == "ping":
                await websocket.send_json({"type": "pong"})

            elif tipo in ("video_offer", "video_answer", "video_ice", "video_state", "chat", "jugada_preview"):
                # Relay a los demás jugadores de la sala (excluyendo IA y el propio remitente)
                payload = dict(data)
                payload["from"] = nombre
                for n, ws in list(sala.sockets.items()):
                    if n == nombre or n == NOMBRE_IA:
                        continue
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass

            else:
                await websocket.send_json({"type": "error", "msg": f"Tipo desconocido: {tipo}"})

    except WebSocketDisconnect:
        pass
    finally:
        sala.sockets.pop(nombre, None)
        # Si la partida no había empezado y se va el creador, dejamos la sala
        # para que vuelva a entrar (durante 6h). Si ambos se van y nadie vuelve,
        # limpiar_viejas la borrará.


# =========== Panel de administración ===========

def _resumen_sala(sala) -> dict:
    estado = sala.estado
    info_jugadores = []
    for nombre in sala.jugadores:
        fichas = len(estado.atriles.get(nombre, [])) if estado else 0
        info_jugadores.append({
            "nombre": nombre,
            "fichas": fichas,
            "conectado": nombre in sala.sockets,
            "ha_salido": (estado.ha_salido.get(nombre, False) if estado else False),
        })
    return {
        "codigo": sala.codigo,
        "jugadores": info_jugadores,
        "partida_iniciada": estado is not None,
        "turno": estado.turno if estado else None,
        "mazo_restante": len(estado.mazo) if estado else None,
        "combinaciones_mesa": len(estado.mesa) if estado else 0,
        "ganador": estado.ganador if estado else None,
        "reglas": sala.reglas,
        "creada": sala.creada,
        "iniciada": sala.iniciada,
        "ultima_accion": sala.ultima_accion,
        "finalizada": sala.finalizada,
    }


@admin_app.get("/api/admin/state")
async def admin_state():
    salas = [_resumen_sala(s) for s in gestor.salas.values()]
    salas.sort(key=lambda s: s["ultima_accion"], reverse=True)
    return {
        "ahora": time.time(),
        "uptime": time.time() - INICIO_SERVER,
        "total_salas": len(salas),
        "salas_activas": sum(1 for s in salas if s["partida_iniciada"] and not s["ganador"]),
        "salas": salas,
    }


@admin_app.post("/api/admin/cerrar/{codigo}")
async def admin_cerrar(codigo: str):
    sala = gestor.obtener(codigo)
    if not sala:
        raise HTTPException(404, "Sala no encontrada")
    for ws in list(sala.sockets.values()):
        try:
            await ws.close(code=1001)
        except Exception:
            pass
    gestor.eliminar(sala.codigo)
    return {"ok": True, "codigo": codigo}


@admin_app.post("/api/admin/cerrar-todas")
async def admin_cerrar_todas():
    codigos = list(gestor.salas.keys())
    for cod in codigos:
        sala = gestor.salas[cod]
        for ws in list(sala.sockets.values()):
            try:
                await ws.close(code=1001)
            except Exception:
                pass
        gestor.eliminar(cod)
    return {"ok": True, "cerradas": len(codigos)}


@admin_app.get("/")
async def admin_root():
    return FileResponse(str(FRONTEND / "admin.html"))


# ===== Ranking =====
@app.get("/api/ranking")
async def api_ranking_publico():
    return {"ranking": stats.ranking()}


# ===== Salas en curso (solo LAN — lo consume el panel de control) =====
@app.get("/api/salas")
async def api_salas(request: Request):
    # Solo localhost: el panel corre en la misma máquina. NO permitir 192.168.*
    # porque el router NAT presenta el tráfico de internet como 192.168.1.1.
    ip = request.client.host if request.client else ""
    if not (ip.startswith("127.") or ip == "::1"):
        raise HTTPException(403, "Solo accesible desde el propio servidor")
    out = []
    for s in gestor.salas.values():
        out.append({
            "codigo": s.codigo,
            "jugadores": list(s.jugadores),
            "conectados": [n for n in s.sockets.keys() if n != NOMBRE_IA],
            "en_juego": bool(s.estado and not s.estado.ganador),
            "ganador": s.estado.ganador if s.estado else None,
        })
    out.sort(key=lambda x: x["codigo"])
    return {"total": len(out), "salas": out}


@admin_app.get("/api/admin/ranking")
async def admin_ranking():
    return {"ranking": stats.ranking()}


@admin_app.post("/api/admin/ranking/renombrar")
async def admin_ranking_renombrar(request: Request):
    body = await request.json()
    viejo = body.get("viejo", "").strip()
    nuevo = body.get("nuevo", "").strip()
    try:
        d = stats.renombrar(viejo, nuevo)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "ranking": stats.ranking()}


@admin_app.post("/api/admin/ranking/reset")
async def admin_ranking_reset():
    stats.resetear()
    return {"ok": True}


# ===== Bots =====
@admin_app.get("/api/admin/bots/stats")
async def admin_bots_stats():
    return bot_log.stats(_bot_baneadas)


@admin_app.get("/api/admin/bots/recent")
async def admin_bots_recent(n: int = 20):
    return {"eventos": bot_log.recientes(n)}


@admin_app.post("/api/admin/bots/desbanear")
async def admin_bots_desbanear(request: Request):
    body = await request.json()
    ip = (body.get("ip") or "").strip()
    if not ip:
        raise HTTPException(400, "Falta ip")
    _bot_baneadas.discard(ip)
    _bot_hits.pop(ip, None)
    return {"ok": True, "ip": ip}


@admin_app.post("/api/admin/bots/reset")
async def admin_bots_reset():
    _bot_hits.clear()
    _bot_baneadas.clear()
    try:
        bot_log.reset()
    except Exception:
        pass
    return {"ok": True}


# Estáticos para el admin (CSS compartido con el frontend principal)
if FRONTEND.exists():
    admin_app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


# Frontend estático
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")

    _NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}

    @app.get("/")
    async def root_index():
        return FileResponse(str(FRONTEND / "index.html"), headers=_NO_CACHE)

    @app.get("/game")
    async def game_page(request: Request):
        from urllib.parse import urlencode
        from fastapi.responses import RedirectResponse
        params = dict(request.query_params)
        if params.get("_v") != _VER:
            params["_v"] = _VER
            return RedirectResponse(f"/game?{urlencode(params)}", status_code=302)
        return FileResponse(str(FRONTEND / "game.html"), headers=_NO_CACHE)



# ── Predictions app (Flask) en /predictions ──────────────────────────────────
# Flask montado vía WSGIMiddleware. Un fichero de flag controla el on/off
# sin reiniciar el servidor. El panel crea/borra el flag directamente.
import sys as _sys
from pathlib import Path as _Path

_PREDICTION_DIR = r"C:\Python\prediction"
_PRED_FLAG_OFF  = ROOT / "predictions_off.flag"   # existe → offline

if _PREDICTION_DIR not in _sys.path:
    _sys.path.insert(0, _PREDICTION_DIR)

try:
    from starlette.middleware.wsgi import WSGIMiddleware as _WSGIMiddleware
    import importlib as _importlib
    _pred_mod  = _importlib.import_module("app")
    _flask_pred = getattr(_pred_mod, "app")
    _wsgi_pred = _WSGIMiddleware(_flask_pred)
    print("[INFO] Predictions cargada — disponible en /predictions", flush=True)
except Exception as _e:
    _wsgi_pred = None
    print(f"[WARN] Predictions no disponible: {_e}", flush=True)


class _PredictionsASGI:
    """Wrapper ASGI que sirve Flask o devuelve 503 según el flag."""
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return
        if _PRED_FLAG_OFF.exists() or _wsgi_pred is None:
            await send({"type": "http.response.start", "status": 503,
                        "headers": [(b"content-type", b"text/html; charset=utf-8")]})
            await send({"type": "http.response.body",
                        "body": b"<h1>Predictions offline</h1>"})
        else:
            await _wsgi_pred(scope, receive, send)


app.mount("/predictions", _PredictionsASGI())


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
