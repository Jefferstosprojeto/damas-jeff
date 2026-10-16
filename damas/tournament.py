"""Modo torneio: eliminatória de 8 fases contra adversários do computador."""

from __future__ import annotations

from dataclasses import dataclass

from .engine import BLACK, WHITE

# (nome do adversário, nível)
OPPONENTS = [
    ("Zeca Peão", "Iniciante"),
    ("Dona Cida", "Iniciante"),
    ("Tião do Bar", "Amador"),
    ("Professora Lúcia", "Amador"),
    ("Seu Bené", "Intermediário"),
    ("Marcão da Praça", "Experiente"),
    ("Dr. Arlindo", "Experiente"),
    ("Mestre Joaquim", "Profissional"),
]
STAGE_NAMES = ["1ª fase", "2ª fase", "3ª fase", "4ª fase", "5ª fase",
               "Quartas de final", "Semifinal", "Final"]


@dataclass
class Tournament:
    round: int = 0  # índice da fase atual (0..7)
    eliminated: bool = False
    champion: bool = False

    @property
    def opponent(self) -> str:
        return OPPONENTS[self.round][0]

    @property
    def level(self) -> str:
        return OPPONENTS[self.round][1]

    @property
    def stage(self) -> str:
        return STAGE_NAMES[self.round]

    @property
    def human_color(self) -> int:
        # Alterna as cores a cada fase: Brancas nas fases ímpares.
        return WHITE if self.round % 2 == 0 else BLACK

    def describe(self) -> str:
        return (f"{self.stage} ({self.round + 1} de {len(OPPONENTS)})\n"
                f"Adversário: {self.opponent} — nível {self.level}\n"
                f"Você joga com as {'Brancas' if self.human_color == WHITE else 'Pretas'}.")

    def record_result(self, human_won: bool | None) -> None:
        """human_won: True vitória, False derrota, None empate (repete a fase)."""
        if human_won is None:
            return
        if not human_won:
            self.eliminated = True
        elif self.round == len(OPPONENTS) - 1:
            self.champion = True
        else:
            self.round += 1
