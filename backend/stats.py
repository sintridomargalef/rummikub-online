"""Persistencia simple del ranking de jugadores en JSON.

Estructura de `data/stats.json`:
    {
      "version": 1,
      "jugadores": {
        "Manel": { "victorias": 5, "partidas": 12, "ultima_partida": 1779127000 }
      }
    }

Es ñ-safe (UTF-8). Escritura atómica vía fichero temporal + os.replace.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from threading import Lock
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
STATS_PATH = ROOT / "data" / "stats.json"
VERSION = 1

# Nombres que NO cuentan para el ranking (placeholders, IA, etc.)
_NOMBRES_EXCLUIDOS = {"", "—", "—", "🤖 IA", "IA"}

_lock = Lock()


def _estructura_vacia() -> dict:
    return {"version": VERSION, "jugadores": {}}


def cargar() -> dict:
    """Lee el fichero; si no existe o está corrupto devuelve estructura vacía."""
    try:
        return json.loads(STATS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _estructura_vacia()


def guardar(d: dict) -> None:
    """Escritura atómica: escribe a .tmp y reemplaza."""
    STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATS_PATH.with_suffix(STATS_PATH.suffix + ".tmp")
    tmp.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, STATS_PATH)


def _normalizar_nombre(n: Optional[str]) -> Optional[str]:
    if not n:
        return None
    s = str(n).strip()
    if not s or s in _NOMBRES_EXCLUIDOS:
        return None
    return s


def registrar_partida(jugadores: list[str], ganador: str,
                      contra_ia: bool = False) -> dict:
    """Incrementa partidas para todos los jugadores y victorias al ganador.

    contra_ia=True → la partida fue contra la IA (se cuentan en columnas separadas).
    Excluye nombres vacíos o de IA. Persiste y devuelve el estado actualizado.
    Thread-safe vía lock interno.
    """
    with _lock:
        d = cargar()
        if "jugadores" not in d:
            d = _estructura_vacia()
        ahora = time.time()
        ganador_norm = _normalizar_nombre(ganador)
        for j in jugadores:
            nombre = _normalizar_nombre(j)
            if not nombre:
                continue
            entry = d["jugadores"].setdefault(nombre, {
                "victorias": 0, "victorias_humano": 0, "victorias_ia": 0,
                "partidas": 0, "partidas_humano": 0, "partidas_ia": 0,
                "ultima_partida": 0,
            })
            # Migración suave: añadir campos nuevos si el entry es antiguo
            for campo in ("victorias_humano", "victorias_ia",
                          "partidas_humano", "partidas_ia"):
                entry.setdefault(campo, 0)
            entry["partidas"] = int(entry.get("partidas", 0)) + 1
            if contra_ia:
                entry["partidas_ia"] = int(entry.get("partidas_ia", 0)) + 1
            else:
                entry["partidas_humano"] = int(entry.get("partidas_humano", 0)) + 1
            entry["ultima_partida"] = ahora
            if nombre == ganador_norm:
                entry["victorias"] = int(entry.get("victorias", 0)) + 1
                if contra_ia:
                    entry["victorias_ia"] = int(entry.get("victorias_ia", 0)) + 1
                else:
                    entry["victorias_humano"] = int(entry.get("victorias_humano", 0)) + 1
        guardar(d)
        return d


def ranking() -> list[dict]:
    """Devuelve la lista de jugadores ordenada por victorias desc, %, partidas desc."""
    d = cargar()
    jugadores = d.get("jugadores", {})
    items: list[dict] = []
    for nombre, info in jugadores.items():
        partidas        = int(info.get("partidas", 0))
        victorias       = int(info.get("victorias", 0))
        victorias_h     = int(info.get("victorias_humano", 0))
        victorias_ia    = int(info.get("victorias_ia", 0))
        partidas_h      = int(info.get("partidas_humano", 0))
        partidas_ia_    = int(info.get("partidas_ia", 0))
        pct             = round(victorias / partidas * 100, 1) if partidas else 0.0
        pct_h           = round(victorias_h / partidas_h * 100, 1) if partidas_h else 0.0
        pct_ia          = round(victorias_ia / partidas_ia_ * 100, 1) if partidas_ia_ else 0.0
        items.append({
            "nombre": nombre,
            "partidas": partidas,
            "victorias": victorias,
            "porcentaje": pct,
            "victorias_humano": victorias_h,
            "partidas_humano": partidas_h,
            "porcentaje_humano": pct_h,
            "victorias_ia": victorias_ia,
            "partidas_ia": partidas_ia_,
            "porcentaje_ia": pct_ia,
            "ultima_partida": info.get("ultima_partida", 0),
        })
    items.sort(
        key=lambda x: (-x["victorias"], -x["porcentaje"], -x["partidas"], x["nombre"])
    )
    return items


def renombrar(viejo: str, nuevo: str) -> dict:
    """Renombra o fusiona si el destino existe. Devuelve la estructura actualizada.

    - Si solo existe `viejo`: cambia la clave a `nuevo`.
    - Si existen ambos: suma victorias y partidas del viejo en el nuevo y borra el viejo.
    - Si solo existe `nuevo` o ninguno: no hace nada (lanza ValueError si `viejo` no existe).
    """
    with _lock:
        v = _normalizar_nombre(viejo)
        n = _normalizar_nombre(nuevo)
        if not v or not n:
            raise ValueError("Nombres inválidos")
        if v == n:
            return cargar()
        d = cargar()
        jugadores = d.setdefault("jugadores", {})
        if v not in jugadores:
            raise ValueError(f"Jugador '{viejo}' no existe")
        info_v = jugadores.pop(v)
        if n in jugadores:
            info_n = jugadores[n]
            info_n["victorias"] = int(info_n.get("victorias", 0)) + int(info_v.get("victorias", 0))
            info_n["partidas"] = int(info_n.get("partidas", 0)) + int(info_v.get("partidas", 0))
            info_n["ultima_partida"] = max(
                info_n.get("ultima_partida", 0), info_v.get("ultima_partida", 0)
            )
        else:
            jugadores[n] = info_v
        guardar(d)
        return d


def resetear() -> dict:
    """Borra todo el ranking (solo admin)."""
    with _lock:
        d = _estructura_vacia()
        guardar(d)
        return d
