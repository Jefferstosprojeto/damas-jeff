/* Damas Jeff — motor de regras de Damas Brasileiras (8x8).
 * Tradução fiel de damas/engine.py (mesmas regras e mesma ordem de lances).
 * Funciona na página e no Web Worker da IA (expõe self.DamasEngine).
 */
(function (root) {
  "use strict";

  const SIZE = 8, EMPTY = 0, WHITE = 1, BLACK = -1, MAN = 1, KING = 2;
  const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const DRAW_PLIES = 40;

  // RAYS[r*8+c][d] = casas ao longo da diagonal d a partir de (r, c).
  const RAYS = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      RAYS.push(DIAGONALS.map(([dr, dc]) => {
        const ray = [];
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
          ray.push([nr, nc]);
          nr += dr; nc += dc;
        }
        return ray;
      }));
    }
  }

  function moveKey(path) {
    return path.map(([r, c]) => r * 8 + c).join(",");
  }

  function squareName([r, c]) {
    return "abcdefgh"[c] + (SIZE - r);
  }

  class Board {
    constructor(grid, turn = WHITE, quiet = 0, backCapture = true) {
      this.grid = grid;
      this.turn = turn;
      this.quiet = quiet; // lances seguidos só com damas e sem captura
      this.backCapture = backCapture;
      this._moves = null;
    }

    static empty(turn = WHITE, backCapture = true) {
      return new Board(Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY)),
        turn, 0, backCapture);
    }

    static initial(backCapture = true) {
      const b = Board.empty(WHITE, backCapture);
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if ((r + c) % 2 === 1) {
            if (r < 3) b.grid[r][c] = BLACK * MAN;
            else if (r > 4) b.grid[r][c] = WHITE * MAN;
          }
        }
      }
      return b;
    }

    copy() {
      return new Board(this.grid.map(row => row.slice()), this.turn, this.quiet, this.backCapture);
    }

    toJSON() {
      return { grid: this.grid, turn: this.turn, quiet: this.quiet, back_capture: this.backCapture };
    }

    static fromJSON(d) {
      if (!d || !Array.isArray(d.grid) || d.grid.length !== SIZE ||
          d.grid.some(row => !Array.isArray(row) || row.length !== SIZE)) {
        throw new Error("tabuleiro inválido");
      }
      const grid = d.grid.map(row => row.map(p => {
        const v = Number(p);
        if (![0, 1, 2, -1, -2].includes(v)) throw new Error("peça inválida");
        return v;
      }));
      const turn = Number(d.turn) === BLACK ? BLACK : WHITE;
      return new Board(grid, turn, Number(d.quiet) || 0, d.back_capture !== false);
    }

    at([r, c]) { return this.grid[r][c]; }

    forward(color) { return color === WHITE ? -1 : 1; }

    pieces(color) {
      const out = [];
      for (let r = 0; r < SIZE; r++) {
        const row = this.grid[r];
        for (let c = 0; c < SIZE; c++) if (row[c] * color > 0) out.push([r, c]);
      }
      return out;
    }

    count(color) {
      let men = 0, kings = 0;
      for (const row of this.grid) {
        for (const p of row) {
          if (p * color > 0) { if (Math.abs(p) === KING) kings++; else men++; }
        }
      }
      return [men, kings];
    }

    // ------------------------------------------------------------ lances
    legalMoves() {
      if (this._moves) return this._moves;
      const own = this.pieces(this.turn);
      let captures = [];
      for (const sq of own) {
        if (this._canCapture(sq)) captures = captures.concat(this._capturesFrom(sq));
      }
      if (captures.length) {
        let best = 0;
        for (const m of captures) best = Math.max(best, m.captured.length);
        return (this._moves = captures.filter(m => m.captured.length === best));
      }
      const grid = this.grid, forward = this.forward(this.turn), moves = [];
      for (const sq of own) {
        const king = Math.abs(grid[sq[0]][sq[1]]) === KING;
        const rays = RAYS[sq[0] * 8 + sq[1]];
        for (let d = 0; d < 4; d++) {
          if (!king && DIAGONALS[d][0] !== forward) continue;
          for (const nsq of rays[d]) {
            if (grid[nsq[0]][nsq[1]] !== EMPTY) break;
            moves.push({ path: [sq, nsq], captured: [] });
            if (!king) break;
          }
        }
      }
      return (this._moves = moves);
    }

    _canCapture(sq) {
      const grid = this.grid, turn = this.turn;
      const king = Math.abs(grid[sq[0]][sq[1]]) === KING;
      const forward = this.forward(turn);
      const rays = RAYS[sq[0] * 8 + sq[1]];
      for (let d = 0; d < 4; d++) {
        if (!king && !this.backCapture && DIAGONALS[d][0] !== forward) continue;
        const ray = rays[d];
        let i = 0;
        if (king) while (i < ray.length && grid[ray[i][0]][ray[i][1]] === EMPTY) i++;
        if (i + 1 < ray.length) {
          const [tr, tc] = ray[i], [lr, lc] = ray[i + 1];
          if (grid[tr][tc] * turn < 0 && grid[lr][lc] === EMPTY) return true;
        }
      }
      return false;
    }

    _capturesFrom(sq) {
      const piece = this.grid[sq[0]][sq[1]];
      const king = Math.abs(piece) === KING;
      const results = [];
      // A peça sai da origem durante o lance (a casa fica livre para passagem).
      this.grid[sq[0]][sq[1]] = EMPTY;
      try {
        this._dfs(sq, king, [sq], [], results);
      } finally {
        this.grid[sq[0]][sq[1]] = piece;
      }
      return results;
    }

    _dfs(sq, king, path, captured, results) {
      const grid = this.grid, turn = this.turn, forward = this.forward(turn);
      const rays = RAYS[sq[0] * 8 + sq[1]];
      let extended = false;
      for (let d = 0; d < 4; d++) {
        if (!king && !this.backCapture && captured.length === 0 && DIAGONALS[d][0] !== forward) {
          continue; // variante: não inicia a captura para trás
        }
        const ray = rays[d];
        let i = 0;
        if (king) while (i < ray.length && grid[ray[i][0]][ray[i][1]] === EMPTY) i++;
        if (i + 1 >= ray.length) continue;
        const target = ray[i];
        // Peças já capturadas continuam no tabuleiro até o fim do lance:
        // bloqueiam a passagem e não podem ser saltadas de novo.
        if (grid[target[0]][target[1]] * turn >= 0 ||
            captured.some(s => s[0] === target[0] && s[1] === target[1])) continue;
        for (let j = i + 1; j < ray.length; j++) {
          const land = ray[j];
          if (grid[land[0]][land[1]] !== EMPTY) break;
          extended = true;
          this._dfs(land, king, path.concat([land]), captured.concat([target]), results);
          if (!king) break;
        }
      }
      if (!extended && captured.length) results.push({ path, captured });
    }

    findMove(path) {
      const key = moveKey(path);
      return this.legalMoves().find(m => moveKey(m.path) === key) || null;
    }

    // ------------------------------------------------------------ aplicar
    apply(move) {
      const b = this.copy();
      const [sr, sc] = move.path[0];
      let piece = b.grid[sr][sc];
      b.grid[sr][sc] = EMPTY;
      for (const [r, c] of move.captured) b.grid[r][c] = EMPTY;
      const [er, ec] = move.path[move.path.length - 1];
      const lastRow = piece > 0 ? 0 : SIZE - 1;
      if (Math.abs(piece) === MAN && er === lastRow) piece = Math.sign(piece) * KING;
      b.grid[er][ec] = piece;
      b.quiet = (move.captured.length || Math.abs(this.grid[sr][sc]) === MAN) ? 0 : this.quiet + 1;
      b.turn = -this.turn;
      return b;
    }

    /** WHITE/BLACK (vencedor), 0 (empate) ou null (em andamento). */
    result() {
      if (!this.legalMoves().length) return -this.turn;
      if (this.quiet >= DRAW_PLIES) return 0;
      return null;
    }
  }

  root.DamasEngine = {
    SIZE, EMPTY, WHITE, BLACK, MAN, KING, DIAGONALS, DRAW_PLIES, RAYS,
    Board, moveKey, squareName,
  };
})(typeof self !== "undefined" ? self : globalThis);
