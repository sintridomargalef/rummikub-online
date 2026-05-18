"""Servidor FastAPI: REST mínimo para crear sala + WebSocket de juego."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .game.state import GameState
from .game.rules import aplicar_jugada, robar_y_pasar
from .game.board import REGLAS_POR_DEFECTO
from .rooms import gestor

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Rummikub Online")


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

    if sala.estado is None:
        await _enviar_lobby(sala)
    else:
        await _broadcast_estado(sala)

    try:
        while True:
            data = await websocket.receive_json()
            tipo = data.get("type")

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
