"""Motor de regras de Damas Brasileiras (8x8).

Regras implementadas:
- Tabuleiro 8x8, casas escuras jogáveis, 12 peças para cada lado.
- Brancas começam; peças simples andam uma casa na diagonal para frente.
- Captura obrigatória; peças simples capturam para frente e para trás.
- Lei da maioria: é obrigatório escolher a sequência que captura mais peças.
- Dama voadora: anda e captura à distância ao longo da diagonal.
- Peças capturadas só saem do tabuleiro ao fim do lance e não podem ser
  saltadas duas vezes.
- Promoção apenas se a peça simples terminar o lance na última fileira.
- Empate após 20 lances seguidos de cada lado só com damas e sem captura.

Variante opcional (back_capture=False): a peça simples não pode iniciar a
captura para trás, mas pode continuar uma sequência para trás.
"""

from __future__ import annotations

from dataclasses import dataclass, field

SIZE = 8
EMPTY = 0
WHITE, BLACK = 1, -1
MAN, KING = 1, 2
DIAGONALS = ((-1, -1), (-1, 1), (1, -1), (1, 1))
DRAW_PLIES = 40

Square = tuple[int, int]


@dataclass(frozen=True)
class Move:
    path: tuple[Square, ...]
    captured: tuple[Square, ...] = ()

    @property
    def start(self) -> Square:
        return self.path[0]

    @property
    def end(self) -> Square:
        return self.path[-1]

    def __str__(self) -> str:
        sep = "x" if self.captured else "-"
        return sep.join(square_name(s) for s in self.path)


def square_name(sq: Square) -> str:
    r, c = sq
    return f"{'abcdefgh'[c]}{SIZE - r}"


def owner(piece: int) -> int:
    return (piece > 0) - (piece < 0)


def in_bounds(r: int, c: int) -> bool:
    return 0 <= r < SIZE and 0 <= c < SIZE


def _ray(r: int, c: int, dr: int, dc: int) -> tuple[Square, ...]:
    squares = []
    r, c = r + dr, c + dc
    while in_bounds(r, c):
        squares.append((r, c))
        r, c = r + dr, c + dc
    return tuple(squares)


# Para cada casa, as casas ao longo de cada diagonal (na ordem de DIAGONALS).
RAYS: dict[Square, tuple[tuple[Square, ...], ...]] = {
    (r, c): tuple(_ray(r, c, dr, dc) for dr, dc in DIAGONALS)
    for r in range(SIZE) for c in range(SIZE)
}


@dataclass
class Board:
    grid: list[list[int]] = field(default_factory=list)
    turn: int = WHITE
    quiet_king_plies: int = 0
    back_capture: bool = True

    @classmethod
    def empty(cls, turn: int = WHITE, back_capture: bool = True) -> "Board":
        return cls([[EMPTY] * SIZE for _ in range(SIZE)], turn, 0, back_capture)

    @classmethod
    def initial(cls, back_capture: bool = True) -> "Board":
        grid = [[EMPTY] * SIZE for _ in range(SIZE)]
        for r in range(SIZE):
            for c in range(SIZE):
                if (r + c) % 2 == 1:
                    if r < 3:
                        grid[r][c] = BLACK * MAN
                    elif r > 4:
                        grid[r][c] = WHITE * MAN
        return cls(grid, WHITE, 0, back_capture)

    def copy(self) -> "Board":
        return Board([row[:] for row in self.grid], self.turn, self.quiet_king_plies,
                     self.back_capture)

    def to_dict(self) -> dict:
        return {"grid": self.grid, "turn": self.turn, "quiet": self.quiet_king_plies,
                "back_capture": self.back_capture}

    @classmethod
    def from_dict(cls, data: dict) -> "Board":
        grid = [[int(p) for p in row] for row in data["grid"]]
        if len(grid) != SIZE or any(len(row) != SIZE for row in grid):
            raise ValueError("tabuleiro inválido")
        return cls(grid, int(data["turn"]), int(data.get("quiet", 0)),
                   bool(data.get("back_capture", True)))

    def find_move(self, path) -> Move | None:
        """Localiza o lance legal com este caminho de casas (ou None)."""
        wanted = tuple(tuple(sq) for sq in path)
        for move in self.legal_moves():
            if move.path == wanted:
                return move
        return None

    def at(self, sq: Square) -> int:
        return self.grid[sq[0]][sq[1]]

    def forward(self, color: int) -> int:
        """Direção da linha para frente: brancas sobem (-1), pretas descem (+1)."""
        return -1 if color == WHITE else 1

    # ------------------------------------------------------------------ lances
    def pieces(self, color: int) -> list[Square]:
        return [(r, c) for r, row in enumerate(self.grid) for c in range(SIZE)
                if row[c] * color > 0]

    def legal_moves(self) -> list[Move]:
        own = self.pieces(self.turn)
        captures: list[Move] = []
        for sq in own:
            if self._can_capture(sq):
                captures.extend(self._captures_from(sq))
        if captures:
            best = max(len(m.captured) for m in captures)
            return [m for m in captures if len(m.captured) == best]

        grid = self.grid
        forward = self.forward(self.turn)
        moves: list[Move] = []
        for sq in own:
            king = abs(grid[sq[0]][sq[1]]) == KING
            for d, ray in enumerate(RAYS[sq]):
                if not king and DIAGONALS[d][0] != forward:
                    continue
                for nsq in ray:
                    if grid[nsq[0]][nsq[1]] != EMPTY:
                        break
                    moves.append(Move((sq, nsq)))
                    if not king:
                        break
        return moves

    def _can_capture(self, sq: Square) -> bool:
        """Teste rápido: existe ao menos um salto possível a partir de sq?"""
        grid, turn = self.grid, self.turn
        king = abs(grid[sq[0]][sq[1]]) == KING
        forward = self.forward(turn)
        for d, ray in enumerate(RAYS[sq]):
            if not king and not self.back_capture and DIAGONALS[d][0] != forward:
                continue
            i, n = 0, len(ray)
            if king:
                while i < n and grid[ray[i][0]][ray[i][1]] == EMPTY:
                    i += 1
            if i + 1 < n:
                tr, tc = ray[i]
                lr, lc = ray[i + 1]
                if grid[tr][tc] * turn < 0 and grid[lr][lc] == EMPTY:
                    return True
        return False

    def _captures_from(self, sq: Square) -> list[Move]:
        piece = self.grid[sq[0]][sq[1]]
        king = abs(piece) == KING
        results: list[Move] = []
        # A peça sai da origem durante o lance (a casa fica livre para passagem).
        self.grid[sq[0]][sq[1]] = EMPTY
        try:
            self._dfs(sq, king, (sq,), (), results)
        finally:
            self.grid[sq[0]][sq[1]] = piece
        return results

    def _dfs(self, sq: Square, king: bool, path, captured, results) -> None:
        grid, turn = self.grid, self.turn
        forward = self.forward(turn)
        extended = False
        for d, ray in enumerate(RAYS[sq]):
            if not king and not self.back_capture and not captured and DIAGONALS[d][0] != forward:
                continue  # variante: não inicia a captura para trás
            i, n = 0, len(ray)
            if king:
                while i < n and grid[ray[i][0]][ray[i][1]] == EMPTY:
                    i += 1
            if i + 1 >= n:
                continue
            target = ray[i]
            # Peças já capturadas continuam no tabuleiro até o fim do lance:
            # bloqueiam a passagem e não podem ser saltadas de novo.
            if grid[target[0]][target[1]] * turn >= 0 or target in captured:
                continue
            for land in ray[i + 1:]:
                if grid[land[0]][land[1]] != EMPTY:
                    break
                extended = True
                self._dfs(land, king, path + (land,), captured + (target,), results)
                if not king:
                    break
        if not extended and captured:
            results.append(Move(path, captured))

    # ------------------------------------------------------------------ aplicar
    def apply(self, move: Move) -> "Board":
        b = self.copy()
        piece = b.at(move.start)
        b.grid[move.start[0]][move.start[1]] = EMPTY
        for r, c in move.captured:
            b.grid[r][c] = EMPTY
        er, ec = move.end
        last_row = 0 if owner(piece) == WHITE else SIZE - 1
        if abs(piece) == MAN and er == last_row:
            piece = owner(piece) * KING
        b.grid[er][ec] = piece

        if move.captured or abs(self.at(move.start)) == MAN:
            b.quiet_king_plies = 0
        else:
            b.quiet_king_plies += 1
        b.turn = -self.turn
        return b

    # ------------------------------------------------------------------ estado
    def count(self, color: int) -> tuple[int, int]:
        men = kings = 0
        for row in self.grid:
            for p in row:
                if owner(p) == color:
                    if abs(p) == KING:
                        kings += 1
                    else:
                        men += 1
        return men, kings

    def result(self) -> int | None:
        """Retorna WHITE/BLACK (vencedor), 0 (empate) ou None (em andamento)."""
        if not self.legal_moves():
            return -self.turn
        if self.quiet_king_plies >= DRAW_PLIES:
            return 0
        return None
