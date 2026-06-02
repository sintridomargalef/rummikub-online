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

    # 4a. regla del comodín: si capturaste un comodín de la mesa,
    #     debe terminar en una combinación nueva (no en el atril)
    mesa_nueva_set = set(mesa_nueva_ids)
    for tid in mesa_antigua_ids:
        if estado.indice[tid].is_joker and tid not in mesa_nueva_set:
            return ResultadoJugada(
                False,
                "Capturaste un comodín pero no lo reincorporaste a la mesa "
                "(debe terminar en una combinación nueva)",
            )

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

    # commit (ordenado)
    def _sort_comb(ids: list[str]) -> list[str]:
        tiles = [estado.indice[i] for i in ids]
        reales = sorted([t for t in tiles if not t.is_joker], key=lambda t: t.number)
        jokers = [t for t in tiles if t.is_joker]
        if not reales:
            return [t.id for t in jokers]
        colores = {t.color for t in reales}
        if len(colores) == 1 and len(reales) >= 2:
            # wrap_13_to_1: si la regla está activa, hay 13, hay 1 y no hay 2 → el 1 va al final
            nums_r = [t.number for t in reales]
            if estado.reglas.get("wrap_13_to_1") and 13 in nums_r and 1 in nums_r and 2 not in nums_r:
                ficha1 = next(t for t in reales if t.number == 1)
                reales = [t for t in reales if t.number != 1] + [ficha1]
            res, j = [], 0
            for i, t in enumerate(reales):
                res.append(t)
                if i < len(reales) - 1:
                    gap = reales[i + 1].number - t.number - 1
                    while gap > 0 and j < len(jokers):
                        res.append(jokers[j])
                        j += 1
                        gap -= 1
            while j < len(jokers):
                res.append(jokers[j])
                j += 1
            return [t.id for t in res]
        return [t.id for t in reales + jokers]

    estado.mesa = [_sort_comb(c) for c in nueva_mesa]
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
