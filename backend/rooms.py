"""Gestor de salas efímeras en memoria."""
from __future__ import annotations

import random
import string
import time
from dataclasses import dataclass, field
from typing import Optional

from .game.state import GameState


def _generar_codigo() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4))


@dataclass
class Sala:
    codigo: str
    jugadores: list[str] = field(default_factory=list)  # nombres
    estado: Optional[GameState] = None
    creada: float = field(default_factory=time.time)
    iniciada: Optional[float] = None   # cuando empezó la partida
    ultima_accion: float = field(default_factory=time.time)
    finalizada: Optional[float] = None  # cuando alguien ganó
    sockets: dict = field(default_factory=dict)  # nombre -> WebSocket
    reglas: dict = field(default_factory=dict)

    def lista(self) -> bool:
        return len(self.jugadores) == 2 and self.estado is not None

    def tocar(self) -> None:
        self.ultima_accion = time.time()


class GestorSalas:
    def __init__(self):
        self.salas: dict[str, Sala] = {}

    def crear(self) -> Sala:
        # código único de 4 letras
        for _ in range(50):
            codigo = _generar_codigo()
            if codigo not in self.salas:
                break
        else:
            raise RuntimeError("No se pudo generar código único")
        sala = Sala(codigo=codigo)
        self.salas[codigo] = sala
        return sala

    def obtener(self, codigo: str) -> Optional[Sala]:
        return self.salas.get(codigo.upper())

    def eliminar(self, codigo: str) -> None:
        self.salas.pop(codigo, None)

    def limpiar_viejas(self, max_edad_seg: int = 3600 * 6) -> None:
        ahora = time.time()
        for cod in list(self.salas.keys()):
            sala = self.salas[cod]
            if not sala.sockets and ahora - sala.creada > max_edad_seg:
                self.salas.pop(cod, None)


gestor = GestorSalas()
