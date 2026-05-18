"""Estado de la partida y snapshots por jugador."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .tiles import Tile, crear_mazo, indexar


@dataclass
class GameState:
    mazo: list[Tile] = field(default_factory=list)
    atriles: dict[str, list[str]] = field(default_factory=dict)   # player_id -> tile_ids
    mesa: list[list[str]] = field(default_factory=list)           # combinaciones (tile_ids)
    turno: str = ""
    orden_jugadores: list[str] = field(default_factory=list)
    ha_salido: dict[str, bool] = field(default_factory=dict)
    indice: dict[str, Tile] = field(default_factory=dict)         # id -> Tile
    ganador: Optional[str] = None
    reglas: dict = field(default_factory=dict)

    @classmethod
    def nueva_partida(
        cls,
        jugadores: list[str],
        seed: Optional[int] = None,
        reglas: Optional[dict] = None,
    ) -> "GameState":
        mazo = crear_mazo(seed=seed)
        idx = indexar(mazo)
        atriles: dict[str, list[str]] = {}
        for p in jugadores:
            atriles[p] = [mazo.pop().id for _ in range(14)]
        return cls(
            mazo=mazo,
            atriles=atriles,
            mesa=[],
            turno=jugadores[0],
            orden_jugadores=list(jugadores),
            ha_salido={p: False for p in jugadores},
            indice=idx,
            reglas=dict(reglas or {}),
        )

    def siguiente_turno(self) -> None:
        i = self.orden_jugadores.index(self.turno)
        self.turno = self.orden_jugadores[(i + 1) % len(self.orden_jugadores)]

    def robar(self, jugador: str) -> Optional[str]:
        if not self.mazo:
            return None
        ficha = self.mazo.pop()
        self.atriles[jugador].append(ficha.id)
        return ficha.id

    def fichas_de(self, tile_ids: list[str]) -> list[Tile]:
        return [self.indice[i] for i in tile_ids]

    def snapshot_para(self, jugador: str) -> dict:
        mesa_publica = [
            [self.indice[i].to_dict() for i in comb] for comb in self.mesa
        ]
        atril_propio = [self.indice[i].to_dict() for i in self.atriles[jugador]]
        rivales = {
            p: len(self.atriles[p])
            for p in self.orden_jugadores
            if p != jugador
        }
        return {
            "tu_atril": atril_propio,
            "mesa": mesa_publica,
            "rivales_fichas": rivales,
            "turno": self.turno,
            "tu_eres": jugador,
            "ha_salido": self.ha_salido,
            "mazo_restante": len(self.mazo),
            "ganador": self.ganador,
            "reglas": self.reglas,
        }
