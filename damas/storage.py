"""Persistência local: jogos salvos e lista de records."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

SAVE_SLOTS = 10
MAX_RECORDS = 100


def data_dir() -> Path:
    base = Path(os.environ.get("APPDATA") or str(Path.home()))
    path = base / "DamasJeff"
    legacy = base / "DamasPy"  # pasta usada antes da troca de nome
    if not path.exists() and legacy.is_dir():
        try:
            legacy.rename(path)
        except OSError:
            pass
    path.mkdir(parents=True, exist_ok=True)
    return path


def _read(name: str, default):
    try:
        return json.loads((data_dir() / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write(name: str, value) -> None:
    target = data_dir() / name
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(target)


def now_text() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M")


# ---------------------------------------------------------------- jogos salvos
def load_slots() -> list[dict | None]:
    slots = _read("jogos_salvos.json", [])
    if not isinstance(slots, list):
        slots = []
    slots = (slots + [None] * SAVE_SLOTS)[:SAVE_SLOTS]
    return slots


def save_slot(index: int, name: str, game: dict) -> None:
    slots = load_slots()
    slots[index] = {"name": name, "date": now_text(), "game": game}
    _write("jogos_salvos.json", slots)


# ---------------------------------------------------------------- records
def load_records() -> dict[str, list[dict]]:
    records = _read("records.json", {})
    return records if isinstance(records, dict) else {}


def qualifies(level: str, seconds: int) -> bool:
    table = load_records().get(level, [])
    return len(table) < MAX_RECORDS or seconds < table[-1]["seconds"]


def add_record(level: str, name: str, seconds: int) -> int:
    """Grava o record e retorna a posição (1 = melhor) ou 0 se não entrou."""
    records = load_records()
    table = records.setdefault(level, [])
    entry = {"name": name, "seconds": seconds, "date": now_text()}
    table.append(entry)
    table.sort(key=lambda e: e["seconds"])
    del table[MAX_RECORDS:]
    _write("records.json", records)
    return table.index(entry) + 1 if entry in table else 0


def format_time(seconds: int) -> str:
    h, rest = divmod(int(seconds), 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"
