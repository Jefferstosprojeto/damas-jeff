"""Jogador computador: busca alfa-beta (PVS) com aprofundamento iterativo.

Técnicas usadas:
- Tabela de transposição com o melhor lance de cada posição (testado primeiro).
- Killer moves e heurística de histórico para ordenar lances quietos.
- Principal Variation Search: janela nula para os lances que não são o primeiro.
- Extensão de capturas (quiescência) e de lance único forçado.
- Avaliação com material, avanço, guarda da fileira de trás, centro, diagonal
  principal para damas, incentivo a trocas quando à frente e finais de empate.
"""

from __future__ import annotations

import random
import time

from .engine import DRAW_PLIES, KING, SIZE, WHITE, Board, Move

WIN_SCORE = 100_000
INF = WIN_SCORE * 2
MAX_PLY = 64

# nível -> (profundidade máxima, aleatoriedade em pontos, tempo limite em segundos)
LEVELS = {
    "Iniciante": (1, 120, None),
    "Amador": (2, 40, None),
    "Intermediário": (4, 12, None),
    "Experiente": (6, 0, None),
    "Profissional": (30, 0, 5.0),
}
DEFAULT_LEVEL = "Intermediário"
MIN_TIMED_DEPTH = 6  # o nível com tempo nunca pensa menos que o "Experiente"

MAN_VALUE = 100
KING_VALUE = 320


class _Timeout(Exception):
    pass


# ---------------------------------------------------------------- avaliação
def _man_table() -> list[list[int]]:
    """Bônus posicional da peça simples branca (as pretas usam o espelho)."""
    advance = [0, 30, 20, 13, 8, 4, 1, 0]  # índice = linha (0 = promoção)
    table = []
    for r in range(SIZE):
        row = []
        for c in range(SIZE):
            v = advance[r]
            if c in (0, SIZE - 1):
                v += 3  # borda: não pode ser capturada de lado
            if 2 <= r <= 5 and 2 <= c <= 5:
                v += 5  # centro
            if r == SIZE - 1:
                v += 10  # guarda da fileira de trás: impede promoção adversária
            row.append(v)
        table.append(row)
    return table


MAN_PST_WHITE = _man_table()
MAN_PST_BLACK = [[MAN_PST_WHITE[SIZE - 1 - r][SIZE - 1 - c] for c in range(SIZE)]
                 for r in range(SIZE)]
KING_PST = [[(20 if r + c == SIZE - 1 else 0) + (6 if 2 <= r <= 5 and 2 <= c <= 5 else 0)
             for c in range(SIZE)] for r in range(SIZE)]


def evaluate(board: Board) -> int:
    """Pontuação do ponto de vista de quem joga (board.turn)."""
    wm = wk = bm = bk = 0
    pos = 0
    lone = {}
    for r, row in enumerate(board.grid):
        for c, p in enumerate(row):
            if p == 0:
                continue
            if p == WHITE:
                wm += 1
                pos += MAN_PST_WHITE[r][c]
            elif p == -1:
                bm += 1
                pos -= MAN_PST_BLACK[r][c]
            elif p == KING:
                wk += 1
                pos += KING_PST[r][c]
                lone[WHITE] = (r, c)
            else:
                bk += 1
                pos -= KING_PST[r][c]
                lone[-1] = (r, c)

    # Finais teoricamente empatados com damas voadoras.
    if wm == 0 and bm == 0:
        if (wk == 1 and bk <= 2) or (bk == 1 and wk <= 2):
            return 0
        if (wk == 1 and bk == 3 and _on_main(lone[WHITE])) or \
           (bk == 1 and wk == 3 and _on_main(lone[-1])):
            return 0

    white = wm * MAN_VALUE + wk * KING_VALUE
    black = bm * MAN_VALUE + bk * KING_VALUE
    diff = white - black
    pieces = wm + wk + bm + bk
    # Quem está à frente ganha mais com trocas (menos peças no tabuleiro).
    trade = diff * (24 - pieces) // 48
    score = diff + trade + pos
    return score if board.turn == WHITE else -score


def _on_main(sq) -> bool:
    return sq[0] + sq[1] == SIZE - 1


# ---------------------------------------------------------------- busca
EXACT, LOWER, UPPER = 0, 1, 2


def _key(board: Board):
    return (tuple(p for row in board.grid for p in row), board.turn)


class Searcher:
    def __init__(self, deadline: float | None = None) -> None:
        self.deadline = deadline
        self.tt: dict = {}
        self.killers: list[list] = [[None, None] for _ in range(MAX_PLY + 2)]
        self.history: dict = {}
        self.nodes = 0

    def _check_time(self) -> None:
        self.nodes += 1
        if self.deadline is not None and (self.nodes & 511) == 0 \
                and time.perf_counter() > self.deadline:
            raise _Timeout

    def order(self, moves: list[Move], ply: int, tt_path=None) -> list[Move]:
        killers = self.killers[ply] if ply <= MAX_PLY else (None, None)
        history = self.history

        def score(m: Move) -> int:
            if tt_path is not None and m.path == tt_path:
                return 1 << 30
            if m.captured:
                return (1 << 20) + len(m.captured)
            if m.path == killers[0]:
                return 1 << 19
            if m.path == killers[1]:
                return 1 << 18
            return history.get((m.start, m.end), 0)

        return sorted(moves, key=score, reverse=True)

    def negamax(self, board: Board, depth: int, alpha: int, beta: int, ply: int) -> int:
        self._check_time()
        moves = board.legal_moves()
        if not moves:
            return -WIN_SCORE + ply  # perder mais tarde é melhor
        if board.quiet_king_plies >= DRAW_PLIES:
            return 0
        capture = bool(moves[0].captured)
        if ply >= MAX_PLY or (depth <= 0 and not capture):
            return evaluate(board)
        if len(moves) == 1 and depth > 0:
            depth += 1  # lance forçado: não gasta profundidade

        key = _key(board)
        entry = self.tt.get(key)
        tt_path = None
        if entry is not None:
            e_depth, flag, value, tt_path = entry
            if e_depth >= depth:
                if flag == EXACT:
                    return value
                if flag == LOWER:
                    alpha = max(alpha, value)
                else:
                    beta = min(beta, value)
                if alpha >= beta:
                    return value
        alpha_orig = alpha

        best, best_move = -INF, None
        first = True
        for move in self.order(moves, ply, tt_path):
            child = board.apply(move)
            if first:
                score = -self.negamax(child, depth - 1, -beta, -alpha, ply + 1)
                first = False
            else:
                score = -self.negamax(child, depth - 1, -alpha - 1, -alpha, ply + 1)
                if alpha < score < beta:
                    score = -self.negamax(child, depth - 1, -beta, -alpha, ply + 1)
            if score > best:
                best, best_move = score, move
            if score > alpha:
                alpha = score
            if alpha >= beta:
                if not move.captured and ply <= MAX_PLY:
                    k = self.killers[ply]
                    if k[0] != move.path:
                        k[1], k[0] = k[0], move.path
                    hk = (move.start, move.end)
                    self.history[hk] = self.history.get(hk, 0) + depth * depth
                break

        flag = UPPER if best <= alpha_orig else LOWER if best >= beta else EXACT
        self.tt[key] = (depth, flag, best, best_move.path if best_move else None)
        return best

    def search_root(self, board: Board, moves: list[Move], depth: int, noise: int):
        """Pontua os lances da raiz. Com `noise`, os lances até `noise` pontos
        abaixo do melhor recebem pontuação exata (para o sorteio dos níveis fáceis)."""
        scored = []
        alpha = -INF
        for move in moves:
            child = board.apply(move)
            if noise or not scored:
                score = -self.negamax(child, depth - 1, -INF, -alpha + noise, 1)
            else:
                score = -self.negamax(child, depth - 1, -alpha - 1, -alpha, 1)
                if score > alpha:
                    score = -self.negamax(child, depth - 1, -INF, -alpha, 1)
            scored.append((score, move))
            alpha = max(alpha, score)
        return scored


def choose_move(board: Board, level: str = DEFAULT_LEVEL) -> Move:
    max_depth, noise, limit = LEVELS[level]
    moves = board.legal_moves()
    if len(moves) == 1:
        return moves[0]

    if limit is None:
        searcher = Searcher()
        scored = searcher.search_root(board, searcher.order(moves, 0), max_depth, noise)
    else:
        # Aprofundamento iterativo: as profundidades até MIN_TIMED_DEPTH sempre
        # terminam; as seguintes só enquanto houver tempo.
        searcher = Searcher()
        deadline = time.perf_counter() + limit
        ordered = searcher.order(moves, 0)
        scored = []
        for depth in range(2, max_depth + 1):
            searcher.deadline = deadline if depth > MIN_TIMED_DEPTH else None
            try:
                result = searcher.search_root(board, ordered, depth, 0)
            except _Timeout:
                break
            scored = result
            # O melhor lance desta iteração é o primeiro a ser testado na próxima.
            ordered = [m for _, m in sorted(scored, key=lambda s: s[0], reverse=True)]
            best = scored and max(s for s, _ in scored)
            if abs(best) >= WIN_SCORE - 1000:
                break  # resultado forçado encontrado
            if searcher.deadline is None and time.perf_counter() > deadline:
                break

    if not noise:
        # Só o melhor lance tem pontuação exata (os demais são limites da janela
        # nula); em empate fica o primeiro na ordem de busca.
        return max(scored, key=lambda s: s[0])[1]
    scored = [(s + random.randint(0, noise), m) for s, m in scored]
    best = max(s for s, _ in scored)
    return random.choice([m for s, m in scored if s == best])
