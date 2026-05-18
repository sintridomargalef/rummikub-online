"""Fichas y mazo de Rummikub.

Cada ficha tiene un id único (string) para que cliente y servidor puedan
referirse a la misma ficha sin ambigüedad. Hay 106 fichas:
  - 104 numeradas: 2 copias × 4 colores × 13 números
  - 2 comodines (jokers)
"""
from __future__ import annotations

import random
from dataclasses import dataclass, asdict
from typing import Optional

COLORES = ("negro", "azul", "rojo", "amarillo")
COLOR_CODE = {"negro": "K", "azul": "B", "rojo": "R", "amarillo": "Y"}


@dataclass(frozen=True)
class Tile:
    id: str
    color: Optional[str]   # None si joker
    number: Optional[int]  # None si joker
    is_joker: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def crear_mazo(seed: Optional[int] = None) -> list[Tile]:
    fichas: list[Tile] = []
    for color in COLORES:
        for n in range(1, 14):
            for copia in ("a", "b"):
                tid = f"{COLOR_CODE[color]}{n}{copia}"
                fichas.append(Tile(id=tid, color=color, number=n))
    fichas.append(Tile(id="J1", color=None, number=None, is_joker=True))
    fichas.append(Tile(id="J2", color=None, number=None, is_joker=True))
    rng = random.Random(seed)
    rng.shuffle(fichas)
    return fichas


def indexar(fichas: list[Tile]) -> dict[str, Tile]:
    return {t.id: t for t in fichas}
