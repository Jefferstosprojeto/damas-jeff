"""Interface gráfica (tkinter) do jogo de damas."""

from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from . import ai, storage
from .dialogs import NewGameDialog, RecordsDialog, SlotDialog
from .engine import BLACK, KING, MAN, SIZE, WHITE, Board, Move, owner
from .net import PROTOCOL, NetLink, local_ip
from .tournament import Tournament

APP_NAME = "Damas Jeff"
CELL = 68
MARGIN = 22
LIGHT = "#f0d9b5"
DARK = "#8b5a2b"
HIGHLIGHT = "#f6e05e"
TARGET = "#68d391"
LAST_MOVE = "#b7791f"
WHITE_PIECE = ("#fdfdfd", "#9a9a9a")
BLACK_PIECE = ("#2b2b2b", "#000000")
MODE_NAMES = {"cpu": "Contra o computador", "tournament": "Torneio",
              "pvp": "Dois jogadores", "net": "Rede (IP)"}

RULES = """Regras (Damas Brasileiras)

• Tabuleiro 8x8; as Brancas começam.
• Peças simples andam uma casa na diagonal para frente.
• A captura é obrigatória e as peças simples capturam para
  frente e para trás, em sequência. (Na variante opcional, a
  peça simples não pode iniciar a captura para trás.)
• Lei da maioria: é obrigatório fazer a jogada que captura
  o maior número de peças.
• A peça que chega à última fileira (terminando o lance lá)
  vira dama, que anda e captura à distância.
• Vence quem capturar ou bloquear todas as peças do adversário.
• Empate: 20 lances seguidos de cada lado só com damas e sem captura.

Como jogar: clique em uma peça e depois na casa de destino.
Em capturas múltiplas, clique nas casas de pouso uma a uma.
◀ ▶ voltam e avançam jogadas (contra o computador e 2 jogadores)."""


def color_name(color: int) -> str:
    return "Brancas" if color == WHITE else "Pretas"


class DamasApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title(APP_NAME)
        root.resizable(False, False)

        self.defaults: dict = {}
        self.mode = "pvp"
        self.human_color = WHITE
        self.level = ai.DEFAULT_LEVEL
        self.states: list[Board] = [Board.initial()]
        self.moves: list[Move] = []
        self.pos = 0
        self.selected = None
        self.clicks: list[tuple[int, int]] = []
        self.thinking = False
        self.game_over = False
        self.game_id = 0
        self.ai_results: queue.Queue = queue.Queue()
        self.tournament: Tournament | None = None
        self.net: NetLink | None = None
        self.net_connected = False
        self.elapsed = 0.0
        self.clock_start: float | None = None
        self.editing = False
        self.edit_board: Board | None = None
        self.edit_piece = tk.IntVar(value=WHITE * MAN)
        self.edit_turn = tk.IntVar(value=WHITE)

        self._build_ui()
        self._build_menu()
        self.redraw()
        self._tick()
        root.after(200, self.new_game)
        root.protocol("WM_DELETE_WINDOW", self.quit)

    # ================================================================== layout
    def _build_ui(self) -> None:
        side = SIZE * CELL + 2 * MARGIN
        self.canvas = tk.Canvas(self.root, width=side, height=side, highlightthickness=0,
                                bg="#3b2414")
        self.canvas.grid(row=0, column=0)
        self.canvas.bind("<Button-1>", self.on_click)
        self.canvas.bind("<Button-3>", self.on_right_click)

        panel = ttk.Frame(self.root, padding=10, width=230)
        panel.grid(row=0, column=1, sticky="ns")
        panel.grid_propagate(False)
        self.panel = panel
        ttk.Label(panel, text=APP_NAME, font=("Segoe UI", 20, "bold")).pack(anchor="w")

        self.info = {}
        info = ttk.Frame(panel)
        info.pack(fill="x", pady=(6, 10))
        for key in ("Modo", "Adversário", "Regra", "Tempo", "Brancas", "Pretas"):
            row = ttk.Frame(info)
            row.pack(fill="x", pady=1)
            ttk.Label(row, text=f"{key}:", width=11, foreground="#666").pack(side="left")
            self.info[key] = ttk.Label(row, text="", wraplength=130)
            self.info[key].pack(side="left", anchor="w")

        self.play_box = ttk.Frame(panel)
        self.play_box.pack(fill="x")
        self.buttons = {}
        for text, cmd in (("Novo jogo", self.new_game), ("Salvar", self.save_game),
                          ("Abrir", self.open_game), ("Editar tabuleiro", self.start_edit),
                          ("Records", self.show_records), ("Regras", self.show_rules)):
            b = ttk.Button(self.play_box, text=text, command=cmd)
            b.pack(fill="x", pady=2)
            self.buttons[text] = b
        nav = ttk.Frame(self.play_box)
        nav.pack(fill="x", pady=(10, 0))
        self.buttons["back"] = ttk.Button(nav, text="◀ Voltar", command=self.go_back)
        self.buttons["back"].pack(side="left", expand=True, fill="x", padx=(0, 2))
        self.buttons["fwd"] = ttk.Button(nav, text="Avançar ▶", command=self.go_forward)
        self.buttons["fwd"].pack(side="left", expand=True, fill="x", padx=(2, 0))

        self.edit_box = ttk.Frame(panel)
        ttk.Label(self.edit_box, text="Clique para colocar a peça;\n"
                  "botão direito apaga a casa.").pack(anchor="w", pady=(0, 6))
        for text, value in (("Peça branca", WHITE * MAN), ("Dama branca", WHITE * KING),
                            ("Peça preta", BLACK * MAN), ("Dama preta", BLACK * KING)):
            ttk.Radiobutton(self.edit_box, text=text, value=value,
                            variable=self.edit_piece).pack(anchor="w")
        ttk.Label(self.edit_box, text="Quem joga primeiro:").pack(anchor="w", pady=(8, 0))
        for text, value in (("Brancas", WHITE), ("Pretas", BLACK)):
            ttk.Radiobutton(self.edit_box, text=text, value=value,
                            variable=self.edit_turn).pack(anchor="w")
        for text, cmd in (("Esvaziar", self.edit_clear), ("Posição inicial", self.edit_reset),
                          ("Concluído", self.finish_edit), ("Cancelar", self.cancel_edit)):
            ttk.Button(self.edit_box, text=text, command=cmd).pack(fill="x", pady=2)

        self.status = tk.Label(self.root, anchor="w", padx=8, font=("Segoe UI", 11),
                               relief="sunken", bd=1)
        self.status.grid(row=1, column=0, columnspan=2, sticky="ew")

    def _build_menu(self) -> None:
        bar = tk.Menu(self.root)
        game = tk.Menu(bar, tearoff=False)
        game.add_command(label="Novo jogo...", accelerator="F2", command=self.new_game)
        game.add_command(label="Salvar...", accelerator="Ctrl+S", command=self.save_game)
        game.add_command(label="Abrir...", accelerator="Ctrl+O", command=self.open_game)
        game.add_command(label="Editar tabuleiro", command=self.start_edit)
        game.add_separator()
        game.add_command(label="Voltar jogada", accelerator="Ctrl+Z", command=self.go_back)
        game.add_command(label="Avançar jogada", accelerator="Ctrl+Y", command=self.go_forward)
        game.add_separator()
        game.add_command(label="Records", command=self.show_records)
        game.add_separator()
        game.add_command(label="Sair", command=self.quit)
        bar.add_cascade(label="Jogo", menu=game)
        help_menu = tk.Menu(bar, tearoff=False)
        help_menu.add_command(label="Regras", command=self.show_rules)
        help_menu.add_command(label="Sobre", command=lambda: messagebox.showinfo(
            "Sobre", f"{APP_NAME} — jogo de damas brasileiras.\nFeito em Python + tkinter."))
        bar.add_cascade(label="Ajuda", menu=help_menu)
        self.root.config(menu=bar)
        self.root.bind("<F2>", lambda e: self.new_game())
        self.root.bind("<Control-s>", lambda e: self.save_game())
        self.root.bind("<Control-o>", lambda e: self.open_game())
        self.root.bind("<Control-z>", lambda e: self.go_back())
        self.root.bind("<Control-y>", lambda e: self.go_forward())

    # ================================================================== estado
    @property
    def board(self) -> Board:
        return self.states[self.pos]

    def cpu_color(self) -> int | None:
        return -self.human_color if self.mode in ("cpu", "tournament") else None

    def can_navigate(self) -> bool:
        return self.mode in ("cpu", "pvp") and not self.thinking and not self.editing

    def flipped(self) -> bool:
        board_owner = self.human_color if self.mode != "pvp" else WHITE
        return board_owner == BLACK

    def opponent_text(self) -> str:
        if self.mode == "cpu":
            return f"Computador ({self.level})"
        if self.mode == "tournament" and self.tournament:
            return f"{self.tournament.opponent} ({self.tournament.level})"
        if self.mode == "net":
            return "Adversário na rede" if self.net_connected else "aguardando conexão..."
        return "—"

    def start_game(self, board: Board, mode: str, human_color: int = WHITE,
                   level: str | None = None, moves=(), pos=None, elapsed=0.0) -> None:
        self.game_id += 1
        self.mode = mode
        self.human_color = human_color
        if level:
            self.level = level
        self.states = [board]
        self.moves = []
        for m in moves:
            self.moves.append(m)
            self.states.append(self.states[-1].apply(m))
        self.pos = len(self.states) - 1 if pos is None else pos
        self.thinking = False
        self.game_over = False
        self.elapsed = elapsed
        self.clock_start = time.perf_counter()
        self.reset_selection()
        self.redraw()
        if self.board.result() is not None and self.pos == len(self.states) - 1:
            self.check_end()
        else:
            self.maybe_cpu_turn()

    def reset_selection(self) -> None:
        self.selected = None
        self.clicks = []

    def stop_net(self) -> None:
        if self.net:
            self.net.close()
        self.net = None
        self.net_connected = False

    # ================================================================== novo jogo
    def new_game(self) -> None:
        if self.editing:
            self.cancel_edit()
        if self.mode == "net" and self.net and not self.game_over and not messagebox.askyesno(
                "Novo jogo", "Abandonar a partida em rede?"):
            return
        cfg = NewGameDialog(self.root, self.defaults).run()
        if not cfg:
            return
        self.defaults = cfg
        self.stop_net()
        self.tournament = None
        mode = cfg["mode"]
        if mode == "cpu":
            self.start_game(Board.initial(cfg["back_capture"]), "cpu",
                            WHITE if cfg["human_white"] else BLACK, cfg["level"])
        elif mode == "pvp":
            self.start_game(Board.initial(cfg["back_capture"]), "pvp")
        elif mode == "tournament":
            self.tournament = Tournament()
            self.tournament_back_capture = cfg["back_capture"]
            self.start_tournament_round()
        else:
            self.start_net(cfg)

    # ================================================================== torneio
    def start_tournament_round(self) -> None:
        t = self.tournament
        messagebox.showinfo("Torneio", t.describe())
        self.start_game(Board.initial(self.tournament_back_capture), "tournament",
                        t.human_color, t.level)

    def finish_tournament_game(self, result: int) -> None:
        t = self.tournament
        won = None if result == 0 else result == self.human_color
        t.record_result(won)
        if t.champion:
            messagebox.showinfo("Torneio", "🏆 Parabéns! Você é o CAMPEÃO do torneio!")
        elif t.eliminated:
            messagebox.showinfo("Torneio", f"Você foi eliminado na {t.stage} por {t.opponent}.\n"
                                           "Tente novamente!")
        else:
            text = ("Empate! A partida será repetida." if won is None
                    else "Vitória! Você avançou para a próxima fase.")
            messagebox.showinfo("Torneio", text)
            self.start_tournament_round()

    # ================================================================== rede
    def start_net(self, cfg: dict) -> None:
        self.net = NetLink()
        self.net_back_capture = cfg["back_capture"]
        self.net_role = cfg["net_role"]
        color = WHITE if self.net_role == "host" else BLACK
        self.start_game(Board.initial(cfg["back_capture"]), "net", color)
        self.game_over = True  # bloqueia o tabuleiro até conectar
        self.clock_start = None
        try:
            if self.net_role == "host":
                self.net.host(cfg["port"])
                self.flash(f"Aguardando adversário... informe seu IP: {local_ip()} "
                           f"(porta {cfg['port']})", ms=0)
            else:
                self.net.join(cfg["ip"], cfg["port"])
                self.flash(f"Conectando em {cfg['ip']}:{cfg['port']}...", ms=0)
        except OSError as exc:
            self.stop_net()
            messagebox.showerror("Rede", str(exc))
            return
        self.root.after(100, self.poll_net, self.net)

    def poll_net(self, link: NetLink) -> None:
        if link is not self.net:
            return
        try:
            while True:
                kind, data = link.inbox.get_nowait()
                self.handle_net(kind, data)
                if link is not self.net:
                    return
        except queue.Empty:
            pass
        self.root.after(100, self.poll_net, link)

    def handle_net(self, kind: str, data) -> None:
        if kind == "connected":
            self.net_connected = True
            if self.net_role == "host":
                self.net.send({"t": "hello", "v": PROTOCOL, "back_capture": self.net_back_capture})
                self.begin_net_game(self.net_back_capture)
        elif kind == "msg":
            t = data.get("t")
            if t == "hello" and self.net_role == "join":
                if data.get("v") != PROTOCOL:
                    self.net_failure("Versões diferentes do jogo.")
                    return
                self.begin_net_game(bool(data.get("back_capture", True)))
            elif t == "move":
                move = self.board.find_move(data.get("path", []))
                if move is None or self.board.turn == self.human_color or self.game_over:
                    self.net_failure("O adversário enviou uma jogada inválida.")
                    return
                self.play(move, by_human=False)
        elif kind in ("closed", "error"):
            self.net_failure(data)

    def begin_net_game(self, back_capture: bool) -> None:
        self.start_game(Board.initial(back_capture), "net", self.human_color)
        self.flash(f"Conectado! Você joga com as {color_name(self.human_color)}.")

    def net_failure(self, text: str) -> None:
        was_playing = not self.game_over
        self.stop_net()
        self.game_over = True
        self.clock_start = None
        self.update_info()
        if was_playing or text:
            messagebox.showwarning("Rede", text)

    # ================================================================== jogadas
    def human_can_move(self) -> bool:
        if self.game_over or self.thinking or self.editing:
            return False
        if self.mode == "pvp":
            return True
        if self.mode == "net" and not self.net_connected:
            return False
        if self.mode in ("tournament", "net") and self.pos != len(self.states) - 1:
            return False
        return self.board.turn == self.human_color

    def candidates(self) -> list[Move]:
        if self.selected is None:
            return []
        n = len(self.clicks)
        return [m for m in self.board.legal_moves()
                if m.start == self.selected and list(m.path[1:n + 1]) == self.clicks]

    def on_click(self, event) -> None:
        sq = self.to_square(event.x, event.y)
        if sq is None:
            return
        if self.editing:
            self.edit_place(sq)
            return
        if not self.human_can_move():
            return

        legal = self.board.legal_moves()
        if sq in {m.start for m in legal} and not self.clicks:
            self.selected = sq
            self.redraw()
            return
        if self.selected is None:
            if owner(self.board.at(sq)) == self.board.turn and legal and legal[0].captured:
                self.flash("Captura obrigatória! Escolha uma peça que possa capturar.")
            return

        n = len(self.clicks)
        options = [m for m in self.candidates() if len(m.path) > n + 1 and m.path[n + 1] == sq]
        if not options:
            self.reset_selection()
            if sq in {m.start for m in legal}:
                self.selected = sq
            self.redraw()
            return
        self.clicks.append(sq)
        finished = [m for m in options if len(m.path) == n + 2]
        if finished:
            self.play(finished[0], by_human=True)
        else:
            self.redraw()

    def play(self, move: Move, by_human: bool) -> None:
        del self.states[self.pos + 1:]
        del self.moves[self.pos:]
        self.states.append(self.board.apply(move))
        self.moves.append(move)
        self.pos += 1
        if by_human and self.mode == "net" and self.net:
            self.net.send({"t": "move", "path": [list(sq) for sq in move.path]})
        self.reset_selection()
        self.redraw()
        if not self.check_end():
            self.maybe_cpu_turn()

    def maybe_cpu_turn(self) -> None:
        cpu = self.cpu_color()
        if (cpu is None or self.game_over or self.board.turn != cpu
                or self.pos != len(self.states) - 1 or self.board.result() is not None):
            return
        self.thinking = True
        self.update_info()
        board, level, gid = self.board.copy(), self.level, self.game_id
        threading.Thread(target=lambda: self.ai_results.put((gid, ai.choose_move(board, level))),
                         daemon=True).start()
        self.root.after(50, self.poll_ai)

    def poll_ai(self) -> None:
        try:
            gid, move = self.ai_results.get_nowait()
        except queue.Empty:
            self.root.after(50, self.poll_ai)
            return
        if gid != self.game_id:
            return  # resultado de um jogo já abandonado
        self.thinking = False
        self.play(move, by_human=False)

    def game_seconds(self) -> int:
        running = time.perf_counter() - self.clock_start if self.clock_start else 0.0
        return int(self.elapsed + running)

    def check_end(self) -> bool:
        result = self.board.result()
        if result is None:
            return False
        self.elapsed = self.game_seconds()
        self.clock_start = None
        self.game_over = True
        self.update_info()
        self.root.after(150, self.announce_end, result, self.game_id)
        return True

    def announce_end(self, result: int, gid: int) -> None:
        if gid != self.game_id:
            return
        if self.mode == "tournament":
            self.finish_tournament_game(result)
            return
        if result == 0:
            messagebox.showinfo("Fim de jogo", "Empate!")
        elif self.mode == "pvp":
            messagebox.showinfo("Fim de jogo", f"As {color_name(result)} venceram!")
        elif result != self.human_color:
            messagebox.showinfo("Fim de jogo", "O computador venceu." if self.mode == "cpu"
                                else "Você perdeu.")
        else:
            seconds = int(self.elapsed)
            messagebox.showinfo("Fim de jogo", f"Você venceu em {storage.format_time(seconds)}! 🎉")
            if self.mode == "cpu" and storage.qualifies(self.level, seconds):
                name = simpledialog.askstring("Records", "Você entrou na lista de records!\n"
                                              "Digite seu nome:", parent=self.root)
                if name and name.strip():
                    place = storage.add_record(self.level, name.strip()[:30], seconds)
                    messagebox.showinfo("Records", f"Você ficou em {place}º lugar no nível "
                                                   f"{self.level}.")
                    RecordsDialog(self.root, self.level).run()

    # ================================================================== navegação
    def go_back(self) -> None:
        if not self.can_navigate() or self.pos == 0:
            return
        target = self.pos - 1
        cpu = self.cpu_color()
        while cpu is not None and target > 0 and self.states[target].turn == cpu:
            target -= 1
        if cpu is not None and self.states[target].turn == cpu:
            return  # o computador começou: não há posição anterior do jogador
        self.goto(target)

    def go_forward(self) -> None:
        if not self.can_navigate() or self.pos >= len(self.states) - 1:
            return
        target = self.pos + 1
        cpu = self.cpu_color()
        while cpu is not None and target < len(self.states) - 1 and self.states[target].turn == cpu:
            target += 1
        self.goto(target)

    def goto(self, index: int) -> None:
        self.pos = index
        at_end = index == len(self.states) - 1
        result = self.board.result()
        self.game_over = at_end and result is not None
        if not self.game_over and self.clock_start is None:
            self.clock_start = time.perf_counter()
        self.reset_selection()
        self.redraw()

    # ================================================================== salvar / abrir
    def save_game(self) -> None:
        if self.mode not in ("cpu", "pvp") or self.editing or self.thinking:
            messagebox.showinfo("Salvar", "Só é possível salvar jogos contra o computador "
                                          "(modo normal) ou de dois jogadores.")
            return
        choice = SlotDialog(self.root, saving=True).run()
        if not choice:
            return
        index, slot = choice
        suggestion = slot["name"] if slot else f"{MODE_NAMES[self.mode]} {storage.now_text()}"
        name = simpledialog.askstring("Salvar jogo", "Nome do jogo:", initialvalue=suggestion,
                                      parent=self.root)
        if not name or not name.strip():
            return
        game = {"mode": self.mode, "human_color": self.human_color, "level": self.level,
                "initial": self.states[0].to_dict(),
                "moves": [[list(sq) for sq in m.path] for m in self.moves],
                "pos": self.pos, "elapsed": self.game_seconds()}
        try:
            storage.save_slot(index, name.strip()[:40], game)
        except OSError as exc:
            messagebox.showerror("Salvar", f"Não foi possível salvar: {exc}")
            return
        self.flash("Jogo salvo.")

    def open_game(self) -> None:
        if self.editing or self.thinking:
            return
        choice = SlotDialog(self.root, saving=False).run()
        if not choice:
            return
        game = choice[1]["game"]
        try:
            board = Board.from_dict(game["initial"])
            moves, current = [], board
            for path in game["moves"]:
                move = current.find_move(path)
                if move is None:
                    raise ValueError("jogada inválida no arquivo")
                moves.append(move)
                current = current.apply(move)
            level = game.get("level", ai.DEFAULT_LEVEL)
            if level not in ai.LEVELS:
                level = ai.DEFAULT_LEVEL
            mode = game["mode"] if game["mode"] in ("cpu", "pvp") else "pvp"
            pos = max(0, min(int(game.get("pos", len(moves))), len(moves)))
        except (KeyError, TypeError, ValueError) as exc:
            messagebox.showerror("Abrir", f"Jogo salvo corrompido: {exc}")
            return
        self.stop_net()
        self.tournament = None
        self.start_game(board, mode, int(game.get("human_color", WHITE)), level, moves, pos,
                        float(game.get("elapsed", 0)))
        self.flash(f"Jogo \"{choice[1]['name']}\" aberto.")

    # ================================================================== editar
    def start_edit(self) -> None:
        if self.mode not in ("cpu", "pvp") or self.thinking:
            messagebox.showinfo("Editar tabuleiro", "Disponível em jogos contra o computador "
                                "(modo normal) ou de dois jogadores.")
            return
        self.editing = True
        self.edit_board = self.board.copy()
        self.edit_turn.set(self.edit_board.turn)
        self.play_box.pack_forget()
        self.edit_box.pack(fill="x")
        self.reset_selection()
        self.redraw()
        self.flash("Editando o tabuleiro.", ms=0)

    def edit_place(self, sq) -> None:
        r, c = sq
        if (r + c) % 2 == 0:
            return
        piece = self.edit_piece.get()
        if abs(piece) == MAN and r == (0 if piece > 0 else SIZE - 1):
            self.flash("Peça simples não pode ficar na fileira de promoção — use uma dama.")
            return
        self.edit_board.grid[r][c] = piece
        self.redraw()

    def on_right_click(self, event) -> None:
        sq = self.to_square(event.x, event.y)
        if self.editing and sq:
            self.edit_board.grid[sq[0]][sq[1]] = 0
            self.redraw()

    def edit_clear(self) -> None:
        self.edit_board = Board.empty(self.edit_turn.get(), self.edit_board.back_capture)
        self.redraw()

    def edit_reset(self) -> None:
        self.edit_board = Board.initial(self.edit_board.back_capture)
        self.edit_turn.set(WHITE)
        self.redraw()

    def finish_edit(self) -> None:
        board = self.edit_board
        if not any(board.count(WHITE)) or not any(board.count(BLACK)):
            messagebox.showwarning("Editar tabuleiro", "Coloque pelo menos uma peça de cada cor.")
            return
        board.turn = self.edit_turn.get()
        board.quiet_king_plies = 0
        self._leave_edit()
        self.start_game(board, self.mode, self.human_color, self.level)

    def cancel_edit(self) -> None:
        self._leave_edit()
        self.redraw()

    def _leave_edit(self) -> None:
        self.editing = False
        self.edit_box.pack_forget()
        self.play_box.pack(fill="x")
        self.update_info()

    # ================================================================== diálogos
    def show_records(self) -> None:
        RecordsDialog(self.root, self.level).run()

    def show_rules(self) -> None:
        messagebox.showinfo("Regras", RULES)

    def quit(self) -> None:
        self.stop_net()
        self.root.destroy()

    # ================================================================== desenho
    def to_square(self, x: int, y: int):
        c, r = (x - MARGIN) // CELL, (y - MARGIN) // CELL
        if not (0 <= r < SIZE and 0 <= c < SIZE):
            return None
        if self.flipped():
            r, c = SIZE - 1 - r, SIZE - 1 - c
        return (r, c)

    def to_xy(self, sq):
        r, c = sq
        if self.flipped():
            r, c = SIZE - 1 - r, SIZE - 1 - c
        return MARGIN + c * CELL, MARGIN + r * CELL

    def redraw(self) -> None:
        cv = self.canvas
        cv.delete("all")
        board = self.edit_board if self.editing else self.board
        targets = set()
        n = len(self.clicks)
        for m in self.candidates():
            if len(m.path) > n + 1:
                targets.add(m.path[n + 1])
        last = set()
        if not self.editing and self.pos > 0:
            last = set(self.moves[self.pos - 1].path)

        for r in range(SIZE):
            for c in range(SIZE):
                x, y = self.to_xy((r, c))
                color = DARK if (r + c) % 2 else LIGHT
                if (r, c) in last:
                    color = LAST_MOVE
                if (r, c) == self.selected or (r, c) in self.clicks:
                    color = HIGHLIGHT
                cv.create_rectangle(x, y, x + CELL, y + CELL, fill=color, width=0)
                if (r, c) in targets:
                    cv.create_oval(x + CELL * .38, y + CELL * .38, x + CELL * .62, y + CELL * .62,
                                   fill=TARGET, outline="")
                piece = board.grid[r][c]
                if piece:
                    self.draw_piece(x, y, piece)

        for i in range(SIZE):
            col = "abcdefgh"[SIZE - 1 - i if self.flipped() else i]
            row = str(i + 1 if self.flipped() else SIZE - i)
            cv.create_text(MARGIN + i * CELL + CELL / 2, MARGIN / 2, text=col, fill="#e8d5b5")
            cv.create_text(MARGIN / 2, MARGIN + i * CELL + CELL / 2, text=row, fill="#e8d5b5")
        self.update_info()

    def draw_piece(self, x, y, piece) -> None:
        fill, edge = WHITE_PIECE if owner(piece) == WHITE else BLACK_PIECE
        pad = CELL * 0.12
        self.canvas.create_oval(x + pad + 3, y + pad + 4, x + CELL - pad + 3, y + CELL - pad + 4,
                                fill="#1a1a1a", outline="")
        self.canvas.create_oval(x + pad, y + pad, x + CELL - pad, y + CELL - pad,
                                fill=fill, outline=edge, width=3)
        inner = CELL * 0.25
        self.canvas.create_oval(x + inner, y + inner, x + CELL - inner, y + CELL - inner,
                                outline=edge, width=1)
        if abs(piece) == KING:
            self.canvas.create_text(x + CELL / 2, y + CELL / 2, text="♛",
                                    font=("Segoe UI Symbol", int(CELL * 0.32)), fill="#d4a017")

    def update_info(self) -> None:
        board = self.edit_board if self.editing else self.board
        wm, wk = board.count(WHITE)
        bm, bk = board.count(BLACK)
        mode = MODE_NAMES[self.mode]
        if self.mode == "tournament" and self.tournament:
            mode += f" — {self.tournament.stage}"
        self.info["Modo"].config(text=mode)
        self.info["Adversário"].config(text=self.opponent_text())
        self.info["Regra"].config(text="Oficial" if board.back_capture
                                  else "Sem iniciar captura para trás")
        self.info["Tempo"].config(text=storage.format_time(self.game_seconds()))
        self.info["Brancas"].config(text=f"{wm} peças, {wk} damas")
        self.info["Pretas"].config(text=f"{bm} peças, {bk} damas")

        nav = "normal" if self.can_navigate() else "disabled"
        self.buttons["back"].config(state=nav if self.pos > 0 else "disabled")
        self.buttons["fwd"].config(state=nav if self.pos < len(self.states) - 1 else "disabled")
        offline = "normal" if self.mode in ("cpu", "pvp") and not self.thinking else "disabled"
        for key in ("Salvar", "Editar tabuleiro"):
            self.buttons[key].config(state=offline)

        if getattr(self, "_flash_until", 0) and time.perf_counter() < self._flash_until:
            return
        if self.editing:
            msg = "Editando o tabuleiro."
        elif self.thinking:
            msg = f"Computador pensando ({self.level})..."
        elif self.game_over and self.board.result() is not None:
            msg = "Fim de jogo — F2 para um novo jogo"
        elif self.mode == "net" and not self.net_connected:
            msg = self.status.cget("text") if self.net else "Sem conexão — F2 para um novo jogo"
        else:
            msg = f"Vez das {color_name(self.board.turn)}"
            if self.mode != "pvp":
                msg += " (você)" if self.board.turn == self.human_color else ""
            if self.pos < len(self.states) - 1:
                msg += "   — revendo jogadas: jogar daqui descarta as seguintes"
        self.status.config(text=msg)

    def flash(self, text: str, ms: int = 2500) -> None:
        self.status.config(text=text)
        self._flash_until = time.perf_counter() + ms / 1000 if ms else 0
        if ms:
            self.root.after(ms, self.update_info)

    def _tick(self) -> None:
        if self.clock_start is not None:
            self.info["Tempo"].config(text=storage.format_time(self.game_seconds()))
        self.root.after(500, self._tick)


def main() -> None:
    root = tk.Tk()
    try:
        ttk.Style(root).theme_use("vista")
    except tk.TclError:
        pass
    DamasApp(root)
    root.mainloop()
