"""Aplicación de jugadas y comprobación de victoria."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .board import validar_mesa, valor_combinacion
from .state import GameState


@dataclass
class ResultadoJugada:
    ok: bool
    error: str = ""


def aplicar_jugada(
    estado: GameState,
    jugador: str,
    nueva_mesa: list[list[str]],
    nuevo_atril: list[str],
) -> ResultadoJugada:
    """Valida y aplica la jugada propuesta por el cliente.

    El cliente envía la mesa completa reorganizada + su atril resultante.
    El servidor verifica:
      1. Es el turno del jugador.
      2. Conservación: los tile_ids de (mesa_antigua ∪ atril_antiguo) = (nueva_mesa ∪ nuevo_atril).
         No se inventan fichas ni se duplican.
      3. Todas las combinaciones de la nueva mesa son válidas.
      4. El jugador ha movido al menos una ficha de su atril a la mesa.
      5. Salida inicial: si aún no ha salido, las fichas nuevas que ha bajado deben
         sumar ≥ 30 y sin manipular combinaciones existentes.
    """
    if estado.ganador is not None:
        return ResultadoJugada(False, "La partida ya ha terminado")
    if estado.turno != jugador:
        return ResultadoJugada(False, "No es tu turno")

    mesa_antigua_ids = {tid for comb in estado.mesa for tid in comb}
    atril_antiguo = set(estado.atriles[jugador])
    universo_antes = mesa_antigua_ids | atril_antiguo

    mesa_nueva_ids = [tid for comb in nueva_mesa for tid in comb]
    atril_nuevo_ids = list(nuevo_atril)
    universo_despues = set(mesa_nueva_ids) | set(atril_nuevo_ids)

    # 2a. mismos ids
    if universo_antes != universo_despues:
        return ResultadoJugada(False, "Las fichas no coinciden con tu atril y la mesa")
    # 2b. sin duplicados
    if len(mesa_nueva_ids) + len(atril_nuevo_ids) != len(universo_despues):
        return ResultadoJugada(False, "Hay fichas duplicadas en tu propuesta")

    # 3. validar todas las combinaciones
    try:
        combinaciones_tiles = [estado.fichas_de(c) for c in nueva_mesa]
    except KeyError:
        return ResultadoJugada(False, "Ficha desconocida en la mesa")
    from .board import es_combinacion_valida
    invalidas = [
        i for i, c in enumerate(combinaciones_tiles)
        if not es_combinacion_valida(c, estado.reglas)
    ]
    if invalidas:
        detalle = ", ".join(str(i + 1) for i in invalidas)
        return ResultadoJugada(
            False, f"Combinación inválida (posición {detalle} en la mesa)"
        )

    # 4. al menos una ficha bajada
    fichas_bajadas = atril_antiguo - set(atril_nuevo_ids)
    if not fichas_bajadas:
        return ResultadoJugada(False, "Debes bajar al menos una ficha o robar")

    # 5. salida inicial
    if not estado.ha_salido[jugador]:
        # las combinaciones que contienen fichas bajadas deben ser combinaciones
        # NUEVAS formadas solo con fichas del atril propio
        suma = 0
        for comb_ids, comb_tiles in zip(nueva_mesa, combinaciones_tiles):
            comb_set = set(comb_ids)
            if comb_set & fichas_bajadas:
                # debe ser totalmente nueva: sin fichas que ya estuvieran en la mesa antigua
                if comb_set & mesa_antigua_ids:
                    return ResultadoJugada(
                        False,
                        "Para tu primera salida no puedes manipular combinaciones existentes",
                    )
                suma += valor_combinacion(comb_tiles)
        if suma < 30:
            return ResultadoJugada(
                False, f"Para tu primera salida debes sumar al menos 30 puntos (llevas {suma})"
            )
        estado.ha_salido[jugador] = True

    # commit
    estado.mesa = [list(c) for c in nueva_mesa]
    estado.atriles[jugador] = list(atril_nuevo_ids)

    if not estado.atriles[jugador]:
        estado.ganador = jugador
        return ResultadoJugada(True)

    estado.siguiente_turno()
    return ResultadoJugada(True)


def robar_y_pasar(estado: GameState, jugador: str) -> ResultadoJugada:
    if estado.ganador is not None:
        return ResultadoJugada(False, "La partida ya ha terminado")
    if estado.turno != jugador:
        return ResultadoJugada(False, "No es tu turno")
    estado.robar(jugador)
    estado.siguiente_turno()
    return ResultadoJugada(True)
