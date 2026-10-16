// Testes da sala online (fila, "quem ganha fica", reconexão). Rodar: node tests/room.test.js
"use strict";
const assert = require("assert");
require("../docs/engine.js");
require("../docs/room.js");
const { Board, WHITE, BLACK, KING } = globalThis.DamasEngine;
const { Room, PROTOCOL, RECONNECT_MS, NEXT_GAME_MS } = globalThis.DamasRoom;

// Relógio e timers falsos para controlar o tempo.
function fakeClock() {
  let t = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => timers.delete(id),
    advance(ms) {
      t += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].fn();
      }
    },
  };
}

function makeRoom(opts = {}) {
  const clock = fakeClock();
  const sent = new Map(), closed = new Set();
  let hostState = null;
  const room = new Room(Object.assign({
    hostId: "H", hostName: "Jeff", hostColor: WHITE, backCapture: true,
    send: (conn, msg) => { if (!sent.has(conn)) sent.set(conn, []); sent.get(conn).push(msg); },
    close: conn => closed.add(conn),
    onChange: st => { hostState = st; },
  }, clock, opts));
  const last = conn => (sent.get(conn) || []).slice(-1)[0];
  const join = (conn, id, name, secret = "s-" + id) => room.join(conn, { v: PROTOCOL, id, secret, name });
  return { room, clock, last, join, closed, host: () => hostState };
}

// Joga até alguém vencer, escolhendo sempre o 1º lance legal; quem joga é dado pela mesa.
function playOut(env, conns) {
  const { room } = env;
  let guard = 0;
  while (room.phase === "playing" && guard++ < 400) {
    const g = room.game, turn = g.board.turn;
    const id = turn === WHITE ? room.seats.white : room.seats.black;
    const path = g.board.legalMoves()[0].path;
    if (id === "H") room.hostMove(path);
    else room.move(conns[id], { path, n: g.moves.length });
  }
}

const tests = {
  "primeiro a chegar senta e a partida começa"() {
    const e = makeRoom();
    assert.strictEqual(e.room.phase, "waiting");
    e.join("c1", "A", "Ana");
    assert.deepStrictEqual(e.room.seats, { white: "H", black: "A" });
    assert.strictEqual(e.room.phase, "playing");
    const st = e.last("c1");
    assert.strictEqual(st.you, "A");
    assert.strictEqual(st.game.no, 1);
  },

  "quem chega com a mesa cheia vai para a fila e assiste"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    e.join("c2", "B", "Bia");
    e.join("c3", "C", "Caio");
    assert.deepStrictEqual(e.room.queue, ["B", "C"]);
    assert.strictEqual(e.last("c3").phase, "playing"); // recebe o tabuleiro para assistir
  },

  "lance de quem não está na vez ou de espectador é recusado"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    e.join("c2", "B", "Bia");
    const path = e.room.game.board.legalMoves()[0].path;
    e.room.move("c1", { path, n: 0 }); // Ana é Pretas, vez das Brancas
    e.room.move("c2", { path, n: 0 }); // Bia está na fila
    assert.strictEqual(e.room.game.moves.length, 0);
    assert.ok(e.room.hostMove(path));
    assert.strictEqual(e.room.game.moves.length, 1);
  },

  "quem ganha fica: vencedor continua, próximo entra de Brancas, perdedor vai para o fim"() {
    const e = makeRoom();
    const conns = { A: "c1", B: "c2", C: "c3" };
    e.join("c1", "A", "Ana"); e.join("c2", "B", "Bia"); e.join("c3", "C", "Caio");
    e.room._resign("A"); // Ana (Pretas) desiste: Jeff vence
    assert.strictEqual(e.room.phase, "over");
    assert.strictEqual(e.room.game.result, WHITE);
    e.clock.advance(NEXT_GAME_MS);
    assert.deepStrictEqual(e.room.seats, { white: "B", black: "H" });
    assert.deepStrictEqual(e.room.queue, ["C", "A"]);
    assert.strictEqual(e.room.phase, "playing");
    assert.strictEqual(e.room.game.no, 2);
    // Agora Bia vence jogando: Jeff vai para a fila
    playOut(e, conns);
    const winner = e.room.game.result === WHITE ? "B" : "H";
    e.clock.advance(NEXT_GAME_MS);
    assert.strictEqual(e.room.seats.white, "C");
    assert.strictEqual(e.room.seats.black, winner);
  },

  "sem fila os dois jogam de novo com cores trocadas"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    e.room.hostResign();
    e.clock.advance(NEXT_GAME_MS);
    assert.deepStrictEqual(e.room.seats, { white: "A", black: "H" });
    assert.strictEqual(e.room.phase, "playing");
  },

  "reconexão com a mesma chave mantém o lugar e a partida"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    const path = e.room.game.board.legalMoves()[0].path;
    e.room.hostMove(path);
    e.room.disconnected("c1");
    e.clock.advance(RECONNECT_MS - 1000);
    e.join("c9", "A", "Ana"); // mesma pessoa, nova conexão
    assert.deepStrictEqual(e.room.seats, { white: "H", black: "A" });
    assert.strictEqual(e.room.phase, "playing");
    assert.strictEqual(e.last("c9").game.moves.length, 1);
    e.clock.advance(5000); // o timer cancelado não pode removê-la
    assert.ok(e.room.members.has("A"));
  },

  "estranho com o link não pega o lugar de quem caiu"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    e.room.disconnected("c1");
    e.join("cX", "A", "Intruso", "outra-chave"); // tenta usar o id da Ana
    assert.strictEqual(e.last("cX").t, "denied");
    assert.ok(e.closed.has("cX"));
    e.join("cY", "Z", "Zé"); // pessoa nova: vai para a fila, não senta
    assert.deepStrictEqual(e.room.seats, { white: "H", black: "A" });
    assert.deepStrictEqual(e.room.queue, ["Z"]);
  },

  "quem não volta em 60s perde a partida e o próximo da fila entra"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana"); e.join("c2", "B", "Bia");
    e.room.disconnected("c1");
    e.clock.advance(RECONNECT_MS);
    assert.ok(!e.room.members.has("A"));
    assert.strictEqual(e.room.game.result, WHITE);
    assert.match(e.room.game.reason, /Ana não voltou/);
    e.clock.advance(NEXT_GAME_MS);
    assert.deepStrictEqual(e.room.seats, { white: "B", black: "H" });
    assert.deepStrictEqual(e.room.queue, []);
  },

  "quem está na fila e cai é pulado e removido depois de 60s"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana"); e.join("c2", "B", "Bia"); e.join("c3", "C", "Caio");
    e.room.disconnected("c2");
    e.room.hostResign();
    e.clock.advance(NEXT_GAME_MS);
    assert.strictEqual(e.room.seats.white, "C"); // Bia (caída) foi pulada
    e.clock.advance(RECONNECT_MS);
    assert.ok(!e.room.members.has("B"));
  },

  "sair da sala durante a partida conta como derrota"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    e.room.leave("c1");
    assert.strictEqual(e.room.game.result, WHITE);
    e.clock.advance(NEXT_GAME_MS);
    assert.strictEqual(e.room.phase, "waiting"); // Jeff espera alguém
    e.join("c2", "B", "Bia");
    assert.strictEqual(e.room.phase, "playing");
  },

  "empate com fila: sai quem está sentado há mais tempo"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana"); e.join("c2", "B", "Bia");
    const g = e.room.game;
    g.board = Board.empty(WHITE); g.board.grid[7][0] = WHITE * KING; g.board.grid[0][7] = BLACK * KING;
    g.board.quiet = 39;
    const path = g.board.legalMoves().find(m => m.path[1][0] === 6).path;
    assert.ok(e.room.hostMove(path));
    assert.strictEqual(e.room.game.result, 0);
    e.clock.advance(NEXT_GAME_MS);
    // Jeff sentou antes de Ana: Jeff vai para a fila
    assert.deepStrictEqual(e.room.seats, { white: "B", black: "A" });
    assert.deepStrictEqual(e.room.queue, ["H"]);
  },

  "versão diferente é recusada; nomes são limpos"() {
    const e = makeRoom();
    e.room.join("c1", { v: 1, id: "A", secret: "x", name: "Ana" });
    assert.strictEqual(e.last("c1").t, "denied");
    e.join("c2", "B", "   Bia    da     Silva  com nome muito comprido ");
    assert.strictEqual(e.room.members.get("B").name, "Bia da Silva com nom");
  },

  "o anfitrião recebe o estado a cada mudança"() {
    const e = makeRoom();
    e.join("c1", "A", "Ana");
    assert.strictEqual(e.host().you, "H");
    assert.deepStrictEqual(e.host().members.map(m => m.name), ["Jeff", "Ana"]);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log("ok   -", name); }
  catch (err) { failed++; console.log("FALHA -", name, "\n      ", err.message); }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} testes passaram`);
process.exit(failed ? 1 : 0);
