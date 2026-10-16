/* Damas Jeff — sala online com fila ("quem ganha fica").
 *
 * Roda no navegador de quem criou a sala (o anfitrião), que é a autoridade:
 * valida os lances, controla mesa, fila e reconexões, e envia o estado
 * completo a todos após cada mudança. Não depende da tela (testável no Node).
 */
(function (root) {
  "use strict";
  const { Board, WHITE, BLACK } = root.DamasEngine;

  const PROTOCOL = 2;
  const RECONNECT_MS = 60000; // tempo para quem caiu voltar
  const NEXT_GAME_MS = 5000;  // intervalo entre partidas

  const cleanName = name => (String(name || "").replace(/\s+/g, " ").trim().slice(0, 20) || "Visitante");

  class Room {
    /**
     * opts: hostId, hostName, hostColor, backCapture,
     *       send(conn, msg), close(conn), onChange(stateDoHost),
     *       now(), setTimer(fn, ms), clearTimer(handle)  (injetáveis nos testes)
     */
    constructor(opts) {
      this.o = Object.assign({
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: h => clearTimeout(h),
      }, opts);
      this.backCapture = opts.backCapture !== false;
      this.members = new Map(); // id -> { id, name, secret, conn, connected, timer, since }
      this.seats = { white: null, black: null };
      this.seatedAt = { white: 0, black: 0 };
      this.queue = [];
      this.phase = "waiting"; // waiting | playing | over
      this.game = null;       // { no, initial, moves, board, result, reason }
      this.gameNo = 0;
      this.nextAt = null;
      this._nextTimer = null;
      this.hostId = opts.hostId;
      this.members.set(opts.hostId, {
        id: opts.hostId, name: cleanName(opts.hostName), secret: null,
        conn: "local", connected: true, timer: null, since: this.o.now(),
      });
      this._seat(opts.hostColor === BLACK ? "black" : "white", opts.hostId);
    }

    // ------------------------------------------------------------ entradas
    join(conn, msg) {
      if (msg.v !== PROTOCOL) {
        this.o.send(conn, { t: "denied", reason: "Versões diferentes do jogo. Recarregue a página." });
        return this.o.close(conn);
      }
      const id = String(msg.id || ""), secret = String(msg.secret || "");
      if (!id || !secret || id === this.hostId) {
        this.o.send(conn, { t: "denied", reason: "Identificação inválida." });
        return this.o.close(conn);
      }
      const known = this.members.get(id);
      if (known) {
        if (known.secret !== secret) {
          // Mesmo id com outra chave: não é a mesma pessoa.
          this.o.send(conn, { t: "denied", reason: "Esse jogador já está na sala." });
          return this.o.close(conn);
        }
        // Reconexão legítima (ou a mesma pessoa abriu outra aba: a nova assume).
        if (known.conn && known.conn !== conn && known.conn !== "local") this.o.close(known.conn);
        known.conn = conn;
        known.connected = true;
        if (msg.name) known.name = cleanName(msg.name);
        if (known.timer) { this.o.clearTimer(known.timer); known.timer = null; }
      } else {
        this.members.set(id, {
          id, name: cleanName(msg.name), secret, conn, connected: true, timer: null, since: this.o.now(),
        });
        this.queue.push(id);
      }
      this._fillSeats();
      this._broadcast();
    }

    move(conn, msg) {
      const m = this._byConn(conn);
      if (m) this._tryMove(m.id, msg.path, msg.n);
    }

    hostMove(path) {
      return this._tryMove(this.hostId, path, this.game ? this.game.moves.length : 0);
    }

    resign(conn) {
      const m = this._byConn(conn);
      if (m) this._resign(m.id);
    }

    hostResign() { this._resign(this.hostId); }

    rename(conn, name) {
      const m = this._byConn(conn);
      if (m) { m.name = cleanName(name); this._broadcast(); }
    }

    hostRename(name) {
      this.members.get(this.hostId).name = cleanName(name);
      this._broadcast();
    }

    leave(conn) {
      const m = this._byConn(conn);
      if (m) this._remove(m.id, `${m.name} saiu da sala`);
    }

    disconnected(conn) {
      const m = this._byConn(conn);
      if (!m) return;
      m.conn = null;
      m.connected = false;
      if (m.timer) this.o.clearTimer(m.timer);
      m.timer = this.o.setTimer(() => {
        m.timer = null;
        if (!m.connected) this._remove(m.id, `${m.name} não voltou`);
      }, RECONNECT_MS);
      this._broadcast();
    }

    close() {
      if (this._nextTimer) this.o.clearTimer(this._nextTimer);
      for (const m of this.members.values()) if (m.timer) this.o.clearTimer(m.timer);
    }

    // ------------------------------------------------------------ partida
    _tryMove(id, path, n) {
      const g = this.game;
      if (this.phase !== "playing" || !g) return false;
      const color = this._colorOf(id);
      if (color === null || g.board.turn !== color || n !== g.moves.length) {
        this._broadcast(); // ressincroniza quem mandou o lance fora de hora
        return false;
      }
      const move = g.board.findMove(path || []);
      if (!move) { this._broadcast(); return false; }
      g.moves.push(move);
      g.board = g.board.apply(move);
      const result = g.board.result();
      if (result !== null) this._end(result, result === 0 ? "empate" : "");
      else this._broadcast();
      return true;
    }

    _resign(id) {
      const color = this._colorOf(id);
      if (this.phase !== "playing" || color === null) return;
      this._end(-color, `${this.members.get(id).name} desistiu`);
    }

    _start() {
      this.gameNo++;
      const initial = Board.initial(this.backCapture);
      this.game = { no: this.gameNo, initial, moves: [], board: initial, result: null, reason: "" };
      this.phase = "playing";
      this.nextAt = null;
    }

    _end(result, reason) {
      this.game.result = result;
      this.game.reason = reason;
      this.phase = "over";
      this.nextAt = this.o.now() + NEXT_GAME_MS;
      if (this._nextTimer) this.o.clearTimer(this._nextTimer);
      this._nextTimer = this.o.setTimer(() => {
        this._nextTimer = null;
        this._rotate();
        this._fillSeats();
        this._broadcast();
      }, NEXT_GAME_MS);
      this._broadcast();
    }

    /** "Quem ganha fica": o vencedor continua, o próximo da fila entra de Brancas,
     *  o perdedor vai para o fim da fila. Sem fila, os dois trocam de cor. */
    _rotate() {
      const g = this.game;
      const w = this.seats.white, b = this.seats.black;
      let winner = null, loser = null;
      if (g && g.result === WHITE) { winner = w; loser = b; }
      else if (g && g.result === BLACK) { winner = b; loser = w; }
      else if (w && b) {
        // Empate: com fila, sai quem está sentado há mais tempo.
        const wOlder = this.seatedAt.white <= this.seatedAt.black;
        winner = wOlder ? b : w;
        loser = wOlder ? w : b;
      } else { winner = w || b; }

      const challenger = this._nextInQueue();
      if (challenger) {
        this.queue = this.queue.filter(id => id !== challenger);
        this.seats = { white: null, black: null };
        this._seat("white", challenger);
        if (winner) this._seat("black", winner);
        if (loser && this.members.has(loser)) this.queue.push(loser);
      } else if (w && b) {
        this.seats = { white: b, black: w };
        [this.seatedAt.white, this.seatedAt.black] = [this.seatedAt.black, this.seatedAt.white];
      }
      this.phase = "waiting";
    }

    _fillSeats() {
      // Só senta alguém com a sala esperando; durante a contagem entre partidas
      // quem decide a próxima mesa é _rotate().
      if (this.phase !== "waiting") return;
      for (const color of ["white", "black"]) {
        if (this.seats[color] === null) {
          const next = this._nextInQueue();
          if (next) {
            this.queue = this.queue.filter(id => id !== next);
            this._seat(color, next);
          }
        }
      }
      if (this.phase === "waiting" && this.seats.white && this.seats.black) this._start();
    }

    _nextInQueue() {
      return this.queue.find(id => this.members.get(id)?.connected) || null;
    }

    _seat(color, id) {
      this.seats[color] = id;
      this.seatedAt[color] = this.o.now();
    }

    _remove(id, reason) {
      const m = this.members.get(id);
      if (!m || id === this.hostId) return;
      if (m.timer) this.o.clearTimer(m.timer);
      const color = this._colorOf(id);
      if (color !== null && this.phase === "playing") this._end(-color, reason); // perde por abandono
      this.members.delete(id);
      this.queue = this.queue.filter(q => q !== id);
      if (this.seats.white === id) this.seats.white = null;
      if (this.seats.black === id) this.seats.black = null;
      if (m.conn && m.conn !== "local") this.o.close(m.conn);
      if (this.phase === "waiting") this._fillSeats();
      this._broadcast();
    }

    // ------------------------------------------------------------ estado
    _colorOf(id) {
      if (this.seats.white === id) return WHITE;
      if (this.seats.black === id) return BLACK;
      return null;
    }

    _byConn(conn) {
      for (const m of this.members.values()) if (m.conn === conn) return m;
      return null;
    }

    stateFor(id) {
      const g = this.game;
      return {
        t: "state", v: PROTOCOL, you: id, host: this.hostId,
        members: [...this.members.values()].map(m => ({ id: m.id, name: m.name, connected: m.connected })),
        seats: { ...this.seats }, queue: [...this.queue], phase: this.phase,
        nextIn: this.nextAt === null ? null : Math.max(0, this.nextAt - this.o.now()),
        backCapture: this.backCapture,
        game: g && {
          no: g.no, initial: g.initial.toJSON(), moves: g.moves.map(m => m.path),
          result: g.result, reason: g.reason,
        },
      };
    }

    _broadcast() {
      for (const m of this.members.values()) {
        if (m.conn && m.conn !== "local" && m.connected) this.o.send(m.conn, this.stateFor(m.id));
      }
      this.o.onChange(this.stateFor(this.hostId));
    }
  }

  root.DamasRoom = { Room, PROTOCOL, RECONNECT_MS, NEXT_GAME_MS, cleanName };
})(typeof self !== "undefined" ? self : globalThis);
