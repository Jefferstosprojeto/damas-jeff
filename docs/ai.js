/* Damas Jeff — jogador computador. Tradução de damas/ai.py:
 * PVS alfa-beta, aprofundamento iterativo, tabela de transposição,
 * killer moves, heurística de histórico e extensão de capturas.
 */
(function (root) {
  "use strict";
  const { SIZE, WHITE, KING, DRAW_PLIES, moveKey } = root.DamasEngine;

  const WIN_SCORE = 100000, INF = WIN_SCORE * 2, MAX_PLY = 64;
  const MAN_VALUE = 100, KING_VALUE = 320;
  const EXACT = 0, LOWER = 1, UPPER = 2;
  const MIN_TIMED_DEPTH = 6;

  // nível -> [profundidade máxima, aleatoriedade, tempo limite em ms]
  const LEVELS = {
    "Iniciante": [1, 120, null],
    "Amador": [2, 40, null],
    "Intermediário": [4, 12, null],
    "Experiente": [6, 0, null],
    "Profissional": [30, 0, 4000],
  };
  const DEFAULT_LEVEL = "Intermediário";

  // ------------------------------------------------------------ avaliação
  const ADVANCE = [0, 30, 20, 13, 8, 4, 1, 0];
  const MAN_PST_WHITE = [], MAN_PST_BLACK = [], KING_PST = [];
  for (let r = 0; r < SIZE; r++) {
    MAN_PST_WHITE.push([]); KING_PST.push([]);
    for (let c = 0; c < SIZE; c++) {
      let v = ADVANCE[r];
      const center = r >= 2 && r <= 5 && c >= 2 && c <= 5;
      if (c === 0 || c === SIZE - 1) v += 3;
      if (center) v += 5;
      if (r === SIZE - 1) v += 10;
      MAN_PST_WHITE[r].push(v);
      KING_PST[r].push((r + c === SIZE - 1 ? 20 : 0) + (center ? 6 : 0));
    }
  }
  for (let r = 0; r < SIZE; r++) {
    MAN_PST_BLACK.push([]);
    for (let c = 0; c < SIZE; c++) MAN_PST_BLACK[r].push(MAN_PST_WHITE[SIZE - 1 - r][SIZE - 1 - c]);
  }
  const onMain = sq => sq[0] + sq[1] === SIZE - 1;

  function evaluate(board) {
    let wm = 0, wk = 0, bm = 0, bk = 0, pos = 0, wKing = null, bKing = null;
    const grid = board.grid;
    for (let r = 0; r < SIZE; r++) {
      const row = grid[r];
      for (let c = 0; c < SIZE; c++) {
        const p = row[c];
        if (p === 0) continue;
        if (p === 1) { wm++; pos += MAN_PST_WHITE[r][c]; }
        else if (p === -1) { bm++; pos -= MAN_PST_BLACK[r][c]; }
        else if (p === KING) { wk++; pos += KING_PST[r][c]; wKing = [r, c]; }
        else { bk++; pos -= KING_PST[r][c]; bKing = [r, c]; }
      }
    }
    // Finais teoricamente empatados com damas voadoras.
    if (wm === 0 && bm === 0) {
      if ((wk === 1 && bk <= 2) || (bk === 1 && wk <= 2)) return 0;
      if ((wk === 1 && bk === 3 && onMain(wKing)) || (bk === 1 && wk === 3 && onMain(bKing))) return 0;
    }
    const diff = (wm * MAN_VALUE + wk * KING_VALUE) - (bm * MAN_VALUE + bk * KING_VALUE);
    const pieces = wm + wk + bm + bk;
    // Quem está à frente ganha mais com trocas (menos peças no tabuleiro).
    const trade = Math.floor(diff * (24 - pieces) / 48);
    const score = diff + trade + pos;
    return board.turn === WHITE ? score : -score;
  }

  // ------------------------------------------------------------ busca
  class Timeout extends Error {}

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const boardKey = b => b.grid.map(row => row.join(",")).join("|") + "/" + b.turn;
  const fromTo = m => moveKey([m.path[0], m.path[m.path.length - 1]]);

  class Searcher {
    constructor(deadline = null) {
      this.deadline = deadline;
      this.tt = new Map();
      this.killers = Array.from({ length: MAX_PLY + 2 }, () => [null, null]);
      this.history = new Map();
      this.nodes = 0;
    }

    checkTime() {
      this.nodes++;
      if (this.deadline !== null && (this.nodes & 511) === 0 && now() > this.deadline) throw new Timeout();
    }

    order(moves, ply, ttPath) {
      const killers = ply <= MAX_PLY ? this.killers[ply] : [null, null];
      const score = m => {
        const k = moveKey(m.path);
        if (ttPath !== null && ttPath !== undefined && k === ttPath) return 2 ** 30;
        if (m.captured.length) return 2 ** 20 + m.captured.length;
        if (k === killers[0]) return 2 ** 19;
        if (k === killers[1]) return 2 ** 18;
        return this.history.get(fromTo(m)) || 0;
      };
      // Ordenação estável, como sorted() do Python.
      return moves.map((m, i) => [score(m), i, m])
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .map(x => x[2]);
    }

    negamax(board, depth, alpha, beta, ply) {
      this.checkTime();
      const moves = board.legalMoves();
      if (!moves.length) return -WIN_SCORE + ply; // perder mais tarde é melhor
      if (board.quiet >= DRAW_PLIES) return 0;
      const capture = moves[0].captured.length > 0;
      if (ply >= MAX_PLY || (depth <= 0 && !capture)) return evaluate(board);
      if (moves.length === 1 && depth > 0) depth += 1; // lance forçado: não gasta profundidade

      const key = boardKey(board);
      const entry = this.tt.get(key);
      let ttPath = null;
      if (entry) {
        const [eDepth, flag, value, path] = entry;
        ttPath = path;
        if (eDepth >= depth) {
          if (flag === EXACT) return value;
          if (flag === LOWER) alpha = Math.max(alpha, value);
          else beta = Math.min(beta, value);
          if (alpha >= beta) return value;
        }
      }
      const alphaOrig = alpha;

      let best = -INF, bestMove = null, first = true;
      for (const move of this.order(moves, ply, ttPath)) {
        const child = board.apply(move);
        let score;
        if (first) {
          score = -this.negamax(child, depth - 1, -beta, -alpha, ply + 1);
          first = false;
        } else {
          score = -this.negamax(child, depth - 1, -alpha - 1, -alpha, ply + 1);
          if (alpha < score && score < beta) score = -this.negamax(child, depth - 1, -beta, -alpha, ply + 1);
        }
        if (score > best) { best = score; bestMove = move; }
        if (score > alpha) alpha = score;
        if (alpha >= beta) {
          if (!move.captured.length && ply <= MAX_PLY) {
            const k = this.killers[ply], mk = moveKey(move.path);
            if (k[0] !== mk) { k[1] = k[0]; k[0] = mk; }
            const hk = fromTo(move);
            this.history.set(hk, (this.history.get(hk) || 0) + depth * depth);
          }
          break;
        }
      }
      const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
      this.tt.set(key, [depth, flag, best, bestMove ? moveKey(bestMove.path) : null]);
      return best;
    }

    searchRoot(board, moves, depth, noise) {
      const scored = [];
      let alpha = -INF;
      for (const move of moves) {
        const child = board.apply(move);
        let score;
        if (noise || !scored.length) {
          score = -this.negamax(child, depth - 1, -INF, -alpha + noise, 1);
        } else {
          score = -this.negamax(child, depth - 1, -alpha - 1, -alpha, 1);
          if (score > alpha) score = -this.negamax(child, depth - 1, -INF, -alpha, 1);
        }
        scored.push([score, move]);
        alpha = Math.max(alpha, score);
      }
      return scored;
    }
  }

  function chooseMove(board, level = DEFAULT_LEVEL, rng = Math.random) {
    const [maxDepth, noise, limit] = LEVELS[level] || LEVELS[DEFAULT_LEVEL];
    const moves = board.legalMoves();
    if (moves.length === 1) return moves[0];

    let scored = [];
    const searcher = new Searcher();
    if (limit === null) {
      scored = searcher.searchRoot(board, searcher.order(moves, 0, null), maxDepth, noise);
    } else {
      // Aprofundamento iterativo: até MIN_TIMED_DEPTH sempre termina; depois, enquanto houver tempo.
      const deadline = now() + limit;
      let ordered = searcher.order(moves, 0, null);
      for (let depth = 2; depth <= maxDepth; depth++) {
        searcher.deadline = depth > MIN_TIMED_DEPTH ? deadline : null;
        try {
          scored = searcher.searchRoot(board, ordered, depth, 0);
        } catch (e) {
          if (e instanceof Timeout) break;
          throw e;
        }
        ordered = scored.map((s, i) => [s[0], i, s[1]])
          .sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[2]);
        const best = Math.max(...scored.map(s => s[0]));
        if (Math.abs(best) >= WIN_SCORE - 1000) break; // resultado forçado encontrado
        if (searcher.deadline === null && now() > deadline) break;
      }
    }

    if (!noise) {
      // Só o melhor lance tem pontuação exata; em empate fica o primeiro da busca.
      let best = scored[0];
      for (const s of scored) if (s[0] > best[0]) best = s;
      return best[1];
    }
    const noisy = scored.map(([s, m]) => [s + Math.floor(rng() * (noise + 1)), m]);
    const top = Math.max(...noisy.map(s => s[0]));
    const options = noisy.filter(s => s[0] === top).map(s => s[1]);
    return options[Math.floor(rng() * options.length)];
  }

  root.DamasAI = { LEVELS, DEFAULT_LEVEL, evaluate, chooseMove, Searcher, WIN_SCORE };
})(typeof self !== "undefined" ? self : globalThis);
