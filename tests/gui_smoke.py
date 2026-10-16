"""Teste de fumaça da interface: executa os fluxos principais sem interação humana.

Uso: python -m tests.gui_smoke  (usa um APPDATA temporário)
"""

import os
import tempfile
import time
import tkinter as tk
from types import SimpleNamespace

os.environ["APPDATA"] = tempfile.mkdtemp()

from damas import gui, storage  # noqa: E402
from damas.engine import BLACK, KING, WHITE, Board  # noqa: E402

shown = []
gui.messagebox.showinfo = lambda *a, **k: shown.append(("info", a[:2]))
gui.messagebox.showwarning = lambda *a, **k: shown.append(("warn", a[:2]))
gui.messagebox.showerror = lambda *a, **k: shown.append(("error", a[:2]))
gui.messagebox.askyesno = lambda *a, **k: True
gui.simpledialog.askstring = lambda *a, **k: "Teste"


def pump(root, seconds=0.0, until=None):
    end = time.perf_counter() + seconds
    while True:
        root.update()
        if until is not None and until():
            return True
        if time.perf_counter() >= end and until is None:
            return True
        if until is not None and time.perf_counter() > end:
            return False
        time.sleep(0.01)


def click(app, sq, button=1):
    x, y = app.to_xy(sq)
    ev = SimpleNamespace(x=x + gui.CELL // 2, y=y + gui.CELL // 2)
    (app.on_click if button == 1 else app.on_right_click)(ev)


def human_move(app):
    move = app.board.legal_moves()[0]
    for sq in move.path:
        click(app, sq)
    return move


gui.DamasApp.new_game = lambda self: None  # não abre o diálogo automático de início


def make_app():
    root = tk.Tk()
    app = gui.DamasApp(root)
    return root, app


root, app = make_app()

# 1) contra o computador: humano joga, computador responde
app.start_game(Board.initial(), "cpu", WHITE, "Iniciante")
for _ in range(3):
    human_move(app)
    assert pump(root, 10, until=lambda: not app.thinking), "computador não respondeu"
assert app.pos == 6 and app.board.turn == WHITE, app.pos
print("cpu: ok, 6 lances")

# 2) voltar / avançar
app.go_back()
assert app.pos == 4
app.go_forward()
assert app.pos == 6
app.go_back(); app.go_back()
human_move(app)  # jogar no meio descarta o futuro
assert pump(root, 10, until=lambda: not app.thinking)
assert app.pos == 4 and len(app.states) == 5, (app.pos, len(app.states))
print("voltar/avançar: ok")

# 3) salvar e abrir
gui.SlotDialog.run = lambda self: (2, None)
app.save_game()
slot = storage.load_slots()[2]
assert slot and slot["name"] == "Teste" and len(slot["game"]["moves"]) == 4
app.start_game(Board.initial(), "pvp")
gui.SlotDialog.run = lambda self: (2, slot)
app.open_game()
assert app.mode == "cpu" and app.pos == 4, (app.mode, app.pos)
print("salvar/abrir: ok")

# 4) editar tabuleiro
app.start_game(Board.initial(), "pvp")
app.start_edit()
app.edit_clear()
app.edit_piece.set(WHITE * KING); click(app, (7, 0))
app.edit_piece.set(BLACK * 1); click(app, (3, 4))
app.edit_piece.set(WHITE * 1); click(app, (0, 1))  # proibido: peça na fileira de promoção
assert app.edit_board.grid[0][1] == 0
click(app, (3, 4), button=3); click(app, (3, 4))  # apaga e recoloca (peça branca)
app.edit_piece.set(BLACK * 1); click(app, (3, 4))
app.finish_edit()
assert not app.editing and len(app.board.legal_moves()) == 3  # dama obrigada a capturar
print("editar: ok")

# 5) torneio: perde de propósito? Simula vitória direta por posição
app.tournament = gui.Tournament()
app.tournament_back_capture = True
app.start_tournament_round()
win = Board.empty(WHITE)
win.grid[4][3] = WHITE * KING
win.grid[3][2] = BLACK * 1
app.start_game(win, "tournament", WHITE, app.tournament.level)
human_move(app)
assert pump(root, 5, until=lambda: app.tournament.round == 1)
assert app.mode == "tournament" and app.human_color == BLACK
print("torneio: ok, avançou para", app.tournament.stage)

# 6) rede: duas janelas no mesmo PC
root2, app2 = make_app()
app.start_net({"back_capture": False, "net_role": "host", "port": 5601, "ip": ""})
app2.start_net({"back_capture": True, "net_role": "join", "port": 5601, "ip": "127.0.0.1"})
ok = pump(root, 5, until=lambda: (root2.update() or True) and app.net_connected
          and app2.net_connected and not app2.game_over)
assert ok, "não conectou"
assert app2.board.back_capture is False, "regra do anfitrião não foi aplicada"
move = human_move(app)
ok = pump(root, 5, until=lambda: (root2.update() or True) and app2.pos == 1)
assert ok and app2.moves[0] == move
human_move(app2)
ok = pump(root, 5, until=lambda: (root2.update() or True) and app.pos == 2)
assert ok
app2.quit()
ok = pump(root, 5, until=lambda: app.net is None)
assert ok and any("saiu" in str(s) for s in shown), shown[-3:]
print("rede: ok (conexão, lances nos dois sentidos, saída detectada)")

app.quit()
print("TODOS OS FLUXOS OK")
