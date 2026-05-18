"""Validación pura de combinaciones (sin estado).

Un grupo: 3-4 fichas con el mismo número y colores distintos.
Una escalera: 3+ fichas del mismo color con números consecutivos (1..13).
Los jokers sustituyen cualquier ficha.

Reglas opcionales (dict `reglas`):
  - wrap_13_to_1: permite ...12-13-1 (el 1 puede ir tras el 13). El 1 colocado
    así NO puede continuar a 2 (es un cierre, no un wraparound completo).
"""
from __future__ import annotations

from .tiles import Tile, COLORES

REGLAS_POR_DEFECTO: dict[str, bool] = {
    "wrap_13_to_1": False,
}


def _separar(fichas: list[Tile]) -> tuple[list[Tile], int]:
    reales = [t for t in fichas if not t.is_joker]
    jokers = sum(1 for t in fichas if t.is_joker)
    return reales, jokers


def es_grupo(fichas: list[Tile]) -> bool:
    if not (3 <= len(fichas) <= 4):
        return False
    reales, jokers = _separar(fichas)
    if not reales:
        return False
    numero = reales[0].number
    if any(t.number != numero for t in reales):
        return False
    colores = [t.color for t in reales]
    if len(set(colores)) != len(colores):
        return False
    # los jokers ocupan colores que faltan; cabe siempre que no excedamos 4
    return len(reales) + jokers <= 4


def _es_escalera_lineal(reales: list[Tile], jokers: int) -> bool:
    """Escalera convencional 1..13 sin wrap."""
    color = reales[0].color
    if any(t.color != color for t in reales):
        return False
    numeros = sorted(t.number for t in reales)
    if len(set(numeros)) != len(numeros):
        return False
    if numeros[0] < 1 or numeros[-1] > 13:
        return False
    huecos = 0
    for a, b in zip(numeros, numeros[1:]):
        huecos += (b - a - 1)
    jokers_restantes = jokers - huecos
    if jokers_restantes < 0:
        return False
    espacio_izq = numeros[0] - 1
    espacio_der = 13 - numeros[-1]
    if jokers_restantes > espacio_izq + espacio_der:
        return False
    longitud = (numeros[-1] - numeros[0] + 1) + jokers_restantes
    return longitud <= 13


def es_escalera(fichas: list[Tile], reglas: dict | None = None) -> bool:
    reglas = reglas or REGLAS_POR_DEFECTO
    if len(fichas) < 3:
        return False
    reales, jokers = _separar(fichas)
    if not reales:
        return False
    color = reales[0].color
    if any(t.color != color for t in reales):
        return False

    if _es_escalera_lineal(reales, jokers):
        return True

    # Regla opcional: wrap 13 -> 1 (el 1 cierra la escalera, no sigue a 2)
    if reglas.get("wrap_13_to_1"):
        numeros = [t.number for t in reales]
        # Solo aplica si hay un 1 y no hay un 2 (no se permite 13-1-2)
        if 1 in numeros and 2 not in numeros:
            # Reconstruimos la escalera tratando el 1 como 14
            rotados = sorted(
                [(14 if t.number == 1 else t.number) for t in reales]
            )
            # comprobar que está en rango [2..14], colores ya son iguales,
            # sin duplicados, y los jokers caben en huecos o extendiendo
            if rotados[0] < 2 or rotados[-1] > 14:
                pass
            elif len(set(rotados)) != len(rotados):
                pass
            else:
                huecos = sum((b - a - 1) for a, b in zip(rotados, rotados[1:]))
                jokers_restantes = jokers - huecos
                if jokers_restantes >= 0:
                    espacio_izq = rotados[0] - 2   # mínimo permitido es 2 (sin wrap doble)
                    espacio_der = 14 - rotados[-1]
                    if jokers_restantes <= espacio_izq + espacio_der:
                        longitud = (rotados[-1] - rotados[0] + 1) + jokers_restantes
                        # debe incluir el 13 (real o como joker) para que el 1 lo cierre
                        if rotados[-1] == 14 and longitud <= 13:
                            tiene_13 = 13 in rotados or jokers_restantes >= 1
                            if tiene_13:
                                return True
    return False


def es_combinacion_valida(fichas: list[Tile], reglas: dict | None = None) -> bool:
    return es_grupo(fichas) or es_escalera(fichas, reglas)


def validar_mesa(combinaciones: list[list[Tile]], reglas: dict | None = None) -> bool:
    return all(es_combinacion_valida(c, reglas) for c in combinaciones)


def valor_combinacion(fichas: list[Tile]) -> int:
    """Suma de puntos de una combinación. Joker vale lo que sustituye.

    Para grupos: cada joker vale el número del grupo.
    Para escaleras: jokers valen los números de los huecos/extensiones que ocupan.
    """
    reales, jokers = _separar(fichas)
    if not reales:
        return 0
    if es_grupo(fichas):
        return reales[0].number * (len(reales) + jokers)
    # escalera
    color = reales[0].color
    numeros = sorted(t.number for t in reales)
    # reconstruir la secuencia con jokers en huecos primero, luego extender derecha, luego izquierda
    secuencia = list(numeros)
    jokers_restantes = jokers
    # rellenar huecos internos
    i = 0
    while i < len(secuencia) - 1 and jokers_restantes > 0:
        if secuencia[i + 1] - secuencia[i] > 1:
            secuencia.insert(i + 1, secuencia[i] + 1)
            jokers_restantes -= 1
        else:
            i += 1
    # extender por la derecha
    while jokers_restantes > 0 and secuencia[-1] < 13:
        secuencia.append(secuencia[-1] + 1)
        jokers_restantes -= 1
    # extender por la izquierda
    while jokers_restantes > 0 and secuencia[0] > 1:
        secuencia.insert(0, secuencia[0] - 1)
        jokers_restantes -= 1
    return sum(secuencia)
