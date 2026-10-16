"""Janelas de diálogo: novo jogo, salvar/abrir e records."""

from __future__ import annotations

import gc
import tkinter as tk
from tkinter import messagebox, ttk

from . import ai, storage
from .net import DEFAULT_PORT, local_ip


class _Modal(tk.Toplevel):
    def __init__(self, parent: tk.Misc, title: str) -> None:
        super().__init__(parent)
        self.title(title)
        self.resizable(False, False)
        self.transient(parent)
        self.result = None
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        self.bind("<Escape>", lambda e: self.destroy())

    def run(self):
        self.update_idletasks()
        parent = self.master
        x = parent.winfo_rootx() + (parent.winfo_width() - self.winfo_width()) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - self.winfo_height()) // 3
        self.geometry(f"+{max(x, 0)}+{max(y, 0)}")
        self.grab_set()
        self.wait_window()
        # Libera as variáveis tkinter do diálogo aqui, na thread principal; se o
        # coletor rodasse na thread da IA, o tkinter emitiria avisos.
        gc.collect()
        return self.result


class NewGameDialog(_Modal):
    """Retorna dict com: mode, human_white, level, back_capture, net_role, ip, port."""

    def __init__(self, parent, defaults: dict) -> None:
        super().__init__(parent, "Novo jogo")
        pad = {"padx": 10, "pady": 3}
        self.mode = tk.StringVar(value=defaults.get("mode", "cpu"))
        self.human_white = tk.BooleanVar(value=defaults.get("human_white", True))
        self.level = tk.StringVar(value=defaults.get("level", ai.DEFAULT_LEVEL))
        self.back_capture = tk.BooleanVar(value=defaults.get("back_capture", True))
        self.net_role = tk.StringVar(value="host")
        self.ip = tk.StringVar(value=defaults.get("ip", ""))
        self.port = tk.StringVar(value=str(defaults.get("port", DEFAULT_PORT)))

        box = ttk.LabelFrame(self, text="Tipo de jogo")
        box.grid(row=0, column=0, sticky="ew", **pad)
        for text, value in (("Contra o computador", "cpu"),
                            ("Torneio contra o computador", "tournament"),
                            ("Dois jogadores (mesmo computador)", "pvp"),
                            ("Rede local / internet (IP)", "net")):
            ttk.Radiobutton(box, text=text, value=value, variable=self.mode,
                            command=self._refresh).pack(anchor="w", padx=8, pady=1)

        self.cpu_box = ttk.LabelFrame(self, text="Contra o computador")
        self.cpu_box.grid(row=1, column=0, sticky="ew", **pad)
        ttk.Label(self.cpu_box, text="Nível:").grid(row=0, column=0, sticky="w", padx=8)
        self.level_combo = ttk.Combobox(self.cpu_box, textvariable=self.level, state="readonly",
                                        values=list(ai.LEVELS), width=16)
        self.level_combo.grid(row=0, column=1, sticky="w", pady=2)
        ttk.Label(self.cpu_box, text="Você joga com:").grid(row=1, column=0, sticky="w", padx=8)
        colors = ttk.Frame(self.cpu_box)
        colors.grid(row=1, column=1, sticky="w")
        self.color_buttons = [
            ttk.Radiobutton(colors, text="Brancas", value=True, variable=self.human_white),
            ttk.Radiobutton(colors, text="Pretas", value=False, variable=self.human_white)]
        for b in self.color_buttons:
            b.pack(side="left", padx=(0, 6))

        self.net_box = ttk.LabelFrame(self, text="Rede")
        self.net_box.grid(row=2, column=0, sticky="ew", **pad)
        ttk.Radiobutton(self.net_box, text=f"Criar jogo (meu IP na rede: {local_ip()})",
                        value="host", variable=self.net_role,
                        command=self._refresh).grid(row=0, column=0, columnspan=2, sticky="w", padx=8)
        ttk.Radiobutton(self.net_box, text="Entrar no jogo de outro computador",
                        value="join", variable=self.net_role,
                        command=self._refresh).grid(row=1, column=0, columnspan=2, sticky="w", padx=8)
        ttk.Label(self.net_box, text="IP do adversário:").grid(row=2, column=0, sticky="w", padx=8)
        self.ip_entry = ttk.Entry(self.net_box, textvariable=self.ip, width=18)
        self.ip_entry.grid(row=2, column=1, sticky="w", pady=2)
        ttk.Label(self.net_box, text="Porta:").grid(row=3, column=0, sticky="w", padx=8)
        ttk.Entry(self.net_box, textvariable=self.port, width=8).grid(row=3, column=1, sticky="w", pady=2)

        self.rule_check = ttk.Checkbutton(
            self, variable=self.back_capture,
            text="Peça simples pode iniciar captura para trás (regra oficial)")
        self.rule_check.grid(row=3, column=0, sticky="w", **pad)

        buttons = ttk.Frame(self)
        buttons.grid(row=4, column=0, sticky="e", padx=10, pady=(6, 10))
        ttk.Button(buttons, text="Iniciar", command=self._ok).pack(side="left", padx=4)
        ttk.Button(buttons, text="Cancelar", command=self.destroy).pack(side="left")
        self.bind("<Return>", lambda e: self._ok())
        self._refresh()

    @staticmethod
    def _enable(widget, on: bool) -> None:
        for child in widget.winfo_children():
            try:
                child.configure(state=("readonly" if isinstance(child, ttk.Combobox) else "normal")
                                if on else "disabled")
            except tk.TclError:
                pass
            NewGameDialog._enable(child, on)

    def _refresh(self) -> None:
        mode = self.mode.get()
        self._enable(self.cpu_box, mode in ("cpu",))
        self._enable(self.net_box, mode == "net")
        if mode == "net":
            self.ip_entry.configure(state="normal" if self.net_role.get() == "join" else "disabled")
        # Na rede, quem cria o jogo define a regra.
        joining = mode == "net" and self.net_role.get() == "join"
        self.rule_check.configure(state="disabled" if joining else "normal")

    def _ok(self) -> None:
        try:
            port = int(self.port.get())
            if not 1 <= port <= 65535:
                raise ValueError
        except ValueError:
            messagebox.showerror("Novo jogo", "Porta inválida.", parent=self)
            return
        if self.mode.get() == "net" and self.net_role.get() == "join" and not self.ip.get().strip():
            messagebox.showerror("Novo jogo", "Informe o IP do adversário.", parent=self)
            return
        self.result = {"mode": self.mode.get(), "human_white": self.human_white.get(),
                       "level": self.level.get(), "back_capture": self.back_capture.get(),
                       "net_role": self.net_role.get(), "ip": self.ip.get().strip(),
                       "port": port}
        self.destroy()


class SlotDialog(_Modal):
    """Escolha de posição para salvar (qualquer) ou abrir (só ocupadas)."""

    def __init__(self, parent, saving: bool) -> None:
        super().__init__(parent, "Salvar jogo" if saving else "Abrir jogo")
        self.saving = saving
        self.slots = storage.load_slots()
        ttk.Label(self, text="Escolha uma posição:" if saving else "Escolha o jogo salvo:"
                  ).pack(anchor="w", padx=10, pady=(10, 2))
        self.listbox = tk.Listbox(self, width=52, height=storage.SAVE_SLOTS, activestyle="none",
                                  font=("Segoe UI", 10))
        self.listbox.pack(padx=10)
        for i, slot in enumerate(self.slots):
            text = f"{i + 1:2d}.  {slot['name']}  ({slot['date']})" if slot else f"{i + 1:2d}.  (vazio)"
            self.listbox.insert("end", text)
        self.listbox.bind("<Double-Button-1>", lambda e: self._ok())
        first = next((i for i, s in enumerate(self.slots) if (s is None) == saving), 0)
        self.listbox.selection_set(first)
        buttons = ttk.Frame(self)
        buttons.pack(anchor="e", padx=10, pady=10)
        ttk.Button(buttons, text="OK", command=self._ok).pack(side="left", padx=4)
        ttk.Button(buttons, text="Cancelar", command=self.destroy).pack(side="left")

    def _ok(self) -> None:
        sel = self.listbox.curselection()
        if not sel:
            return
        index = sel[0]
        slot = self.slots[index]
        if not self.saving and slot is None:
            messagebox.showinfo("Abrir jogo", "Esta posição está vazia.", parent=self)
            return
        if self.saving and slot is not None and not messagebox.askyesno(
                "Salvar jogo", f"Substituir \"{slot['name']}\"?", parent=self):
            return
        self.result = (index, slot)
        self.destroy()


class RecordsDialog(_Modal):
    def __init__(self, parent, level: str) -> None:
        super().__init__(parent, "Records")
        self.records = storage.load_records()
        self.level = tk.StringVar(value=level)
        top = ttk.Frame(self)
        top.pack(fill="x", padx=10, pady=(10, 4))
        ttk.Label(top, text="Nível:").pack(side="left")
        combo = ttk.Combobox(top, textvariable=self.level, values=list(ai.LEVELS),
                             state="readonly", width=16)
        combo.pack(side="left", padx=6)
        combo.bind("<<ComboboxSelected>>", lambda e: self._fill())
        ttk.Label(top, text="(menor tempo de vitória)").pack(side="left")
        self.tree = ttk.Treeview(self, columns=("pos", "nome", "tempo", "data"),
                                 show="headings", height=14)
        for col, text, width in (("pos", "#", 40), ("nome", "Nome", 180),
                                 ("tempo", "Tempo", 80), ("data", "Data", 130)):
            self.tree.heading(col, text=text)
            self.tree.column(col, width=width, anchor="center" if col != "nome" else "w")
        self.tree.pack(padx=10)
        ttk.Button(self, text="Fechar", command=self.destroy).pack(anchor="e", padx=10, pady=10)
        self._fill()

    def _fill(self) -> None:
        self.tree.delete(*self.tree.get_children())
        for i, e in enumerate(self.records.get(self.level.get(), []), 1):
            self.tree.insert("", "end", values=(i, e["name"], storage.format_time(e["seconds"]),
                                                e["date"]))
