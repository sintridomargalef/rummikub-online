"""Servidor FastAPI: REST mínimo para crear sala + WebSocket de juego."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

from .game.state import GameState
from .game.rules import aplicar_jugada, robar_y_pasar
from .game.board import REGLAS_POR_DEFECTO
from .rooms import gestor

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

INICIO_SERVER = time.time()
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "rummikub2026")

app = FastAPI(title="Rummikub Online")
security = HTTPBasic()


def comprobar_admin(creds: HTTPBasicCredentials = Depends(security)) -> str:
    ok_user = secrets.compare_digest(creds.username, ADMIN_USER)
    ok_pass = secrets.compare_digest(creds.password, ADMIN_PASSWORD)
    if not (ok_user and ok_pass):
        raise HTTPException(
            status_code=401,
            detail="Credenciales inválidas",
            headers={"WWW-Authenticate": "Basic"},
        )
    return creds.username


@app.post("/api/sala")
async def crear_sala(request: Request):
    sala = gestor.crear()
    try:
        body = await request.json()
    except Exception:
        body = {}
    reglas_in = body.get("reglas", {}) if isinstance(body, dict) else {}
    sala.reglas = {k: bool(reglas_in.get(k, v)) for k, v in REGLAS_POR_DEFECTO.items()}
    return {"codigo": sala.codigo, "reglas": sala.reglas}


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


async def _broadcast_estado(sala) -> None:
    if not sala.estado:
        return
    for nombre, ws in list(sala.sockets.items()):
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

    if nombre not in sala.jugadores:
        if len(sala.jugadores) >= 2:
            await websocket.send_json({"type": "error", "msg": "Sala llena"})
            await websocket.close()
            return
        sala.jugadores.append(nombre)

    sala.sockets[nombre] = websocket

    # si ya hay 2 jugadores y no se ha iniciado partida, iniciarla
    if len(sala.jugadores) == 2 and sala.estado is None:
        sala.estado = GameState.nueva_partida(sala.jugadores, reglas=sala.reglas)
        sala.iniciada = time.time()

    sala.tocar()
    if sala.estado is None:
        await _enviar_lobby(sala)
    else:
        await _broadcast_estado(sala)

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
                        for n, ws in list(sala.sockets.items()):
                            try:
                                await ws.send_json({"type": "fin_partida", "ganador": sala.estado.ganador})
                            except Exception:
                                pass

            elif tipo == "robar":
                res = robar_y_pasar(sala.estado, nombre)
                if not res.ok:
                    await websocket.send_json({"type": "error", "msg": res.error})
                else:
                    await _broadcast_estado(sala)

            elif tipo == "ping":
                await websocket.send_json({"type": "pong"})

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


@app.get("/api/admin/state")
async def admin_state(_user: str = Depends(comprobar_admin)):
    salas = [_resumen_sala(s) for s in gestor.salas.values()]
    salas.sort(key=lambda s: s["ultima_accion"], reverse=True)
    return {
        "ahora": time.time(),
        "uptime": time.time() - INICIO_SERVER,
        "total_salas": len(salas),
        "salas_activas": sum(1 for s in salas if s["partida_iniciada"] and not s["ganador"]),
        "salas": salas,
    }


@app.post("/api/admin/cerrar/{codigo}")
async def admin_cerrar(codigo: str, _user: str = Depends(comprobar_admin)):
    sala = gestor.obtener(codigo)
    if not sala:
        raise HTTPException(404, "Sala no encontrada")
    # cerrar todos los sockets primero
    for ws in list(sala.sockets.values()):
        try:
            await ws.close(code=1001)
        except Exception:
            pass
    gestor.eliminar(sala.codigo)
    return {"ok": True, "codigo": codigo}


@app.post("/api/admin/cerrar-todas")
async def admin_cerrar_todas(_user: str = Depends(comprobar_admin)):
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


@app.get("/admin")
async def admin_page(_user: str = Depends(comprobar_admin)):
    return FileResponse(str(FRONTEND / "admin.html"))


# Frontend estático
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")

    @app.get("/")
    async def root_index():
        return FileResponse(str(FRONTEND / "index.html"))

    @app.get("/game")
    async def game_page():
        return FileResponse(str(FRONTEND / "game.html"))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
