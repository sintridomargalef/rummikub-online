"""Tests del motor de juego."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.game.tiles import Tile, crear_mazo
from backend.game.board import (
    es_grupo, es_escalera, es_combinacion_valida, valor_combinacion
)
from backend.game.state import GameState
from backend.game.rules import aplicar_jugada, robar_y_pasar


def t(color, n, id=None):
    return Tile(id=id or f"{color[0].upper()}{n}", color=color, number=n)


def j(id="J1"):
    return Tile(id=id, color=None, number=None, is_joker=True)


# ===== Grupos =====
def test_grupo_valido_3():
    assert es_grupo([t("rojo", 7), t("azul", 7), t("negro", 7)])


def test_grupo_valido_4():
    assert es_grupo([t("rojo", 7), t("azul", 7), t("negro", 7), t("amarillo", 7)])


def test_grupo_invalido_distinto_numero():
    assert not es_grupo([t("rojo", 7), t("azul", 8), t("negro", 7)])


def test_grupo_invalido_colores_repetidos():
    assert not es_grupo([t("rojo", 7), t("rojo", 7, "R7b"), t("negro", 7)])


def test_grupo_con_joker():
    assert es_grupo([t("rojo", 7), t("azul", 7), j()])


def test_grupo_invalido_5_fichas():
    assert not es_grupo([t("rojo", 7), t("azul", 7), t("negro", 7), t("amarillo", 7), j()])


# ===== Escaleras =====
def test_escalera_valida():
    assert es_escalera([t("rojo", 3), t("rojo", 4, "R4a"), t("rojo", 5, "R5a")])


def test_escalera_con_joker_hueco():
    # 3-?-5 rojo
    assert es_escalera([t("rojo", 3), j(), t("rojo", 5)])


def test_escalera_con_joker_extiende():
    # 3-4-5 + joker como 6
    assert es_escalera([t("rojo", 3), t("rojo", 4, "R4a"), t("rojo", 5, "R5a"), j()])


def test_escalera_invalida_colores_distintos():
    assert not es_escalera([t("rojo", 3), t("azul", 4), t("rojo", 5)])


def test_escalera_invalida_no_consecutivos():
    assert not es_escalera([t("rojo", 3), t("rojo", 5, "R5a"), t("rojo", 7)])


def test_escalera_extiende_con_jokers():
    # 12-13 + 2 jokers es válido (jokers ocupan 10-11, escalera 10-11-12-13)
    assert es_escalera([t("rojo", 12), t("rojo", 13), j("J1"), j("J2")])


def test_escalera_no_cabe_en_1_13():
    # solo jokers (sin ancla de color) → inválido
    assert not es_escalera([j("J1"), j("J2"), j("J3")])


# ===== Regla opcional wrap_13_to_1 =====
def test_wrap_13_to_1_desactivada_por_defecto():
    # 12-13-1 mismo color: con reglas por defecto debe ser inválido
    fichas = [t("rojo", 12), t("rojo", 13), t("rojo", 1, "R1a")]
    assert not es_escalera(fichas)


def test_wrap_13_to_1_activa_permite_cierre():
    reglas = {"wrap_13_to_1": True}
    fichas = [t("rojo", 11), t("rojo", 12), t("rojo", 13), t("rojo", 1, "R1a")]
    assert es_escalera(fichas, reglas)


def test_wrap_13_to_1_no_permite_1_2():
    # Si el 1 va detrás del 13, no puede continuar a 2
    reglas = {"wrap_13_to_1": True}
    fichas = [t("rojo", 12), t("rojo", 13), t("rojo", 1, "R1a"), t("rojo", 2)]
    assert not es_escalera(fichas, reglas)


def test_wrap_13_to_1_corta_sin_13_no_aplica():
    # 1-2-3 normal sigue siendo válido
    reglas = {"wrap_13_to_1": True}
    assert es_escalera([t("rojo", 1), t("rojo", 2), t("rojo", 3)], reglas)


# ===== Valor =====
def test_valor_grupo():
    assert valor_combinacion([t("rojo", 7), t("azul", 7), t("negro", 7)]) == 21


def test_valor_grupo_con_joker():
    assert valor_combinacion([t("rojo", 7), t("azul", 7), j()]) == 21


def test_valor_escalera():
    assert valor_combinacion([t("rojo", 3), t("rojo", 4, "R4a"), t("rojo", 5, "R5a")]) == 12


def test_valor_escalera_joker_hueco():
    # 3 + 4(joker) + 5 = 12
    assert valor_combinacion([t("rojo", 3), j(), t("rojo", 5)]) == 12


# ===== Mazo =====
def test_mazo_tiene_106_fichas():
    m = crear_mazo(seed=1)
    assert len(m) == 106
    jokers = [x for x in m if x.is_joker]
    assert len(jokers) == 2
    ids = {x.id for x in m}
    assert len(ids) == 106


# ===== Flujo de partida =====
def test_partida_repartir_14():
    estado = GameState.nueva_partida(["A", "B"], seed=42)
    assert len(estado.atriles["A"]) == 14
    assert len(estado.atriles["B"]) == 14
    assert len(estado.mazo) == 106 - 28


def test_robar_pasa_turno():
    estado = GameState.nueva_partida(["A", "B"], seed=42)
    assert estado.turno == "A"
    res = robar_y_pasar(estado, "A")
    assert res.ok
    assert estado.turno == "B"
    assert len(estado.atriles["A"]) == 15


def test_aplicar_jugada_no_es_tu_turno():
    estado = GameState.nueva_partida(["A", "B"], seed=42)
    res = aplicar_jugada(estado, "B", [], list(estado.atriles["B"]))
    assert not res.ok
    assert "turno" in res.error.lower()


def test_salida_inicial_minimo_30():
    # Construimos manualmente un estado donde A tiene un grupo 10-10-10 (=30)
    estado = GameState.nueva_partida(["A", "B"], seed=42)
    # forzar atril de A: tres dieces de colores distintos + relleno
    diez_rojo = Tile(id="R10a", color="rojo", number=10)
    diez_azul = Tile(id="B10a", color="azul", number=10)
    diez_negro = Tile(id="K10a", color="negro", number=10)
    estado.indice[diez_rojo.id] = diez_rojo
    estado.indice[diez_azul.id] = diez_azul
    estado.indice[diez_negro.id] = diez_negro
    estado.atriles["A"] = [diez_rojo.id, diez_azul.id, diez_negro.id]

    res = aplicar_jugada(
        estado, "A",
        nueva_mesa=[[diez_rojo.id, diez_azul.id, diez_negro.id]],
        nuevo_atril=[],
    )
    assert res.ok, res.error
    assert estado.ha_salido["A"]
    assert estado.ganador == "A"  # se quedó sin fichas


def test_salida_inicial_menos_de_30_falla():
    estado = GameState.nueva_partida(["A", "B"], seed=42)
    t1 = Tile(id="R3a", color="rojo", number=3)
    t2 = Tile(id="R4a", color="rojo", number=4)
    t3 = Tile(id="R5a", color="rojo", number=5)
    for x in (t1, t2, t3):
        estado.indice[x.id] = x
    estado.atriles["A"] = [t1.id, t2.id, t3.id]
    res = aplicar_jugada(
        estado, "A",
        nueva_mesa=[[t1.id, t2.id, t3.id]],
        nuevo_atril=[],
    )
    assert not res.ok
    assert "30" in res.error


def test_jugada_fichas_inventadas_falla():
    estado = GameState.nueva_partida(["A", "B"], seed=42)
    res = aplicar_jugada(
        estado, "A",
        nueva_mesa=[["FAKE1", "FAKE2", "FAKE3"]],
        nuevo_atril=list(estado.atriles["A"]),
    )
    assert not res.ok
