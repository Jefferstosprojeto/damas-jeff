import time
import unittest

from damas import ai
from damas.engine import BLACK, EMPTY, KING, MAN, SIZE, WHITE, Board


def empty_board(turn=WHITE) -> Board:
    return Board([[EMPTY] * SIZE for _ in range(SIZE)], turn)


def put(board: Board, sq, piece) -> None:
    board.grid[sq[0]][sq[1]] = piece


class EngineTests(unittest.TestCase):
    def test_initial_position(self):
        b = Board.initial()
        self.assertEqual(b.count(WHITE), (12, 0))
        self.assertEqual(b.count(BLACK), (12, 0))
        self.assertEqual(len(b.legal_moves()), 7)

    def test_men_move_only_forward(self):
        b = empty_board()
        put(b, (4, 3), WHITE * MAN)
        ends = {m.end for m in b.legal_moves()}
        self.assertEqual(ends, {(3, 2), (3, 4)})

    def test_capture_is_mandatory(self):
        b = empty_board()
        put(b, (5, 0), WHITE * MAN)
        put(b, (5, 6), WHITE * MAN)
        put(b, (4, 5), BLACK * MAN)
        moves = b.legal_moves()
        self.assertEqual(len(moves), 1)
        self.assertEqual(moves[0].captured, ((4, 5),))

    def test_man_captures_backwards(self):
        b = empty_board()
        put(b, (3, 3), WHITE * MAN)
        put(b, (4, 4), BLACK * MAN)
        moves = b.legal_moves()
        self.assertEqual([m.end for m in moves], [(5, 5)])

    def test_majority_rule(self):
        b = empty_board()
        put(b, (7, 0), WHITE * MAN)
        # Caminho A: uma captura. Caminho B (outra peça): duas capturas.
        put(b, (6, 1), BLACK * MAN)
        put(b, (7, 4), WHITE * MAN)
        put(b, (6, 5), BLACK * MAN)
        put(b, (4, 5), BLACK * MAN)
        moves = b.legal_moves()
        self.assertTrue(moves)
        self.assertTrue(all(len(m.captured) == 2 for m in moves))
        self.assertEqual(moves[0].start, (7, 4))

    def test_flying_king_moves_and_captures_at_distance(self):
        b = empty_board()
        put(b, (7, 0), WHITE * KING)
        self.assertEqual(len(b.legal_moves()), 7)
        put(b, (3, 4), BLACK * MAN)
        moves = b.legal_moves()
        self.assertEqual({m.end for m in moves}, {(2, 5), (1, 6), (0, 7)})
        self.assertTrue(all(m.captured == ((3, 4),) for m in moves))

    def test_cannot_jump_same_piece_twice(self):
        b = empty_board()
        put(b, (4, 1), WHITE * KING)
        put(b, (3, 2), BLACK * MAN)
        for m in b.legal_moves():
            self.assertEqual(len(set(m.captured)), len(m.captured))

    def test_promotion_only_at_end_of_move(self):
        b = empty_board()
        put(b, (1, 2), WHITE * MAN)
        board = b.apply(b.legal_moves()[0])
        self.assertIn(KING, [abs(p) for row in board.grid for p in row])

        b = empty_board()
        # Passa pela última fileira no meio da captura e volta: não promove.
        put(b, (2, 1), WHITE * MAN)
        put(b, (1, 2), BLACK * MAN)
        put(b, (1, 4), BLACK * MAN)
        moves = b.legal_moves()
        self.assertEqual(len(moves[0].captured), 2)
        after = b.apply(moves[0])
        self.assertEqual(after.at(moves[0].end), WHITE * MAN)

    def test_no_moves_loses(self):
        b = empty_board(turn=BLACK)
        put(b, (0, 1), WHITE * MAN)
        self.assertEqual(b.result(), WHITE)

    def test_variant_man_cannot_start_capture_backwards(self):
        b = empty_board()
        b.back_capture = False
        put(b, (3, 3), WHITE * MAN)
        put(b, (4, 4), BLACK * MAN)
        self.assertFalse(any(m.captured for m in b.legal_moves()))

    def test_variant_man_may_continue_capture_backwards(self):
        b = empty_board()
        b.back_capture = False
        put(b, (4, 1), WHITE * MAN)
        put(b, (3, 2), BLACK * MAN)  # 1º salto para frente: (4,1) -> (2,3)
        put(b, (3, 4), BLACK * MAN)  # 2º salto para trás: (2,3) -> (4,5)
        moves = b.legal_moves()
        self.assertEqual(len(moves), 1)
        self.assertEqual(moves[0].path, ((4, 1), (2, 3), (4, 5)))

    def test_serialization_roundtrip_and_find_move(self):
        b = Board.initial(back_capture=False)
        b = b.apply(b.legal_moves()[0])
        again = Board.from_dict(b.to_dict())
        self.assertEqual(again.grid, b.grid)
        self.assertEqual((again.turn, again.back_capture), (b.turn, False))
        move = again.legal_moves()[0]
        self.assertEqual(again.find_move([list(sq) for sq in move.path]), move)
        self.assertIsNone(again.find_move([[0, 0], [1, 1]]))

    def test_tournament_progression(self):
        from damas.tournament import Tournament
        t = Tournament()
        self.assertEqual(t.human_color, WHITE)
        t.record_result(None)
        self.assertEqual(t.round, 0)
        for _ in range(7):
            t.record_result(True)
        self.assertEqual(t.round, 7)
        self.assertEqual(t.level, "Profissional")
        t.record_result(True)
        self.assertTrue(t.champion)
        t2 = Tournament()
        t2.record_result(False)
        self.assertTrue(t2.eliminated)

    def test_all_ai_levels_respect_time(self):
        for level, (_, _, limit) in ai.LEVELS.items():
            b = Board.initial()
            for _ in range(3):
                start = time.perf_counter()
                b = b.apply(ai.choose_move(b, level))
                self.assertLess(time.perf_counter() - start, (limit or 3) + 1.5, level)

    def test_ai_takes_winning_capture(self):
        b = empty_board()
        put(b, (5, 2), WHITE * MAN)
        put(b, (4, 3), BLACK * MAN)
        put(b, (5, 6), WHITE * MAN)
        put(b, (0, 7), BLACK * MAN)
        # Lance quieto deixaria a peça ser capturada; a captura é obrigatória mesmo assim,
        # e o computador deve ganhar a partida a partir daqui.
        self.assertEqual(ai.choose_move(b, "Profissional").captured, ((4, 3),))

    def test_known_draw_endings(self):
        b = empty_board()
        put(b, (7, 0), WHITE * KING)
        put(b, (0, 1), BLACK * KING)
        put(b, (0, 3), BLACK * KING)
        self.assertEqual(ai.evaluate(b), 0)  # 2 damas x 1 dama: empate
        put(b, (0, 5), BLACK * KING)
        self.assertEqual(ai.evaluate(b), 0)  # 3 x 1 com a dama solitária na diagonal principal
        b.grid[7][0] = 0
        put(b, (6, 3), WHITE * KING)
        self.assertNotEqual(ai.evaluate(b), 0)  # fora da diagonal principal: não é empate


if __name__ == "__main__":
    unittest.main()
