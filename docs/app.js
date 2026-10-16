/* Damas Jeff — interface da versão web. */
(function () {
  "use strict";

  const { Board, WHITE, BLACK, MAN, KING, SIZE, moveKey } = DamasEngine;
  const AI = DamasAI;
  const $ = id => document.getElementById(id);

  const MODE_NAMES = {
    cpu: "Contra o computador", tournament: "Torneio",
    pvp: "Dois jogadores", online: "Online (link)",
  };
  const OPPONENTS = [
    ["Zeca Peão", "Iniciante"], ["Dona Cida", "Iniciante"], ["Tião do Bar", "Amador"],
    ["Professora Lúcia", "Amador"], ["Seu Bené", "Intermediário"], ["Marcão da Praça", "Experiente"],
    ["Dr. Arlindo", "Experiente"], ["Mestre Joaquim", "Profissional"],
  ];
  const STAGES = ["1ª fase", "2ª fase", "3ª fase", "4ª fase", "5ª fase",
    "Quartas de final", "Semifinal", "Final"];
  const SAVE_SLOTS = 10, MAX_RECORDS = 100;
  const colorName = c => (c === WHITE ? "Brancas" : "Pretas");

  // ============================================================ armazenamento local
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("damasjeff." + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("damasjeff." + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
  };
  const nowText = () => new Date().toLocaleString("pt-BR",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  function formatTime(seconds) {
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // ============================================================ estado
  const S = {
    mode: "pvp", humanColor: WHITE, level: AI.DEFAULT_LEVEL,
    states: [Board.initial()], moves: [], pos: 0,
    selected: null, clicks: [], thinking: false, gameOver: false, gameId: 0,
    tournament: null, tournamentBack: true,
    elapsed: 0, clockStart: null,
    editing: false, editBoard: null,
    net: null, netConnected: false, netWaiting: false,
    room: null, roomState: null, seatColor: null, gameNo: 0, endText: "", nextAtLocal: null,
    joinCode: null, denied: false,
    flashUntil: 0, sound: store.get("sound", true),
    lastCfg: store.get("lastCfg", { mode: "cpu", level: AI.DEFAULT_LEVEL, color: WHITE, back: true }),
  };
  const board = () => S.states[S.pos];
  const atEnd = () => S.pos === S.states.length - 1;
  const cpuColor = () => (S.mode === "cpu" || S.mode === "tournament" ? -S.humanColor : null);
  const canNavigate = () => (S.mode === "cpu" || S.mode === "pvp") && !S.thinking && !S.editing;
  const flipped = () => S.mode !== "pvp" && S.humanColor === BLACK;
  const gameSeconds = () => S.elapsed + (S.clockStart ? (performance.now() - S.clockStart) / 1000 : 0);

  // ============================================================ som
  let audio = null;
  function beep(freq, ms, delay = 0) {
    if (!S.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay / 1000;
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.value = freq; osc.type = "triangle";
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start(t); osc.stop(t + ms / 1000 + 0.02);
    } catch (e) { /* sem som neste navegador */ }
  }
  const soundMove = m => (m.captured.length ? (beep(520, 90), beep(700, 120, 90)) : beep(420, 70));
  const soundEnd = win => (win ? [523, 659, 784].forEach((f, i) => beep(f, 160, i * 150)) : beep(220, 300));

  // ============================================================ diálogos
  let modalChain = Promise.resolve();
  /** Mostra uma mensagem; retorna o valor do botão escolhido (ou o texto digitado). */
  function modal({ title, text, buttons = [{ label: "OK", value: "ok", primary: true }], input = null }) {
    const run = () => new Promise(resolve => {
      const dlg = $("dlg-msg");
      $("msg-title").textContent = title;
      $("msg-text").textContent = text || "";
      const inp = $("msg-input");
      inp.hidden = input === null;
      if (input !== null) inp.value = input;
      // Enter confirma (o envio implícito do formulário usaria o primeiro botão, "Cancelar").
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); dlg.close("ok"); } };
      const box = $("msg-buttons");
      box.innerHTML = "";
      for (const b of buttons) {
        const el = document.createElement("button");
        el.value = b.value; el.textContent = b.label;
        if (b.primary) el.className = "primary";
        box.appendChild(el);
      }
      dlg.addEventListener("close", function done() {
        dlg.removeEventListener("close", done);
        const v = dlg.returnValue;
        resolve(input !== null ? (v === "ok" ? inp.value.trim() : null) : v);
      });
      dlg.returnValue = "";
      dlg.showModal();
      if (input !== null) { inp.focus(); inp.select(); }
    });
    const p = modalChain.then(run);
    modalChain = p.catch(() => {});
    return p;
  }
  const alertBox = (title, text) => modal({ title, text });
  const confirmBox = async (title, text, yes = "Sim", no = "Não") =>
    (await modal({ title, text, buttons: [{ label: no, value: "no" }, { label: yes, value: "yes", primary: true }] })) === "yes";
  const promptBox = (title, text, value = "") =>
    modal({ title, text, input: value, buttons: [{ label: "Cancelar", value: "cancel" }, { label: "OK", value: "ok", primary: true }] });

  function openDialog(id) {
    const dlg = $(id);
    return new Promise(resolve => {
      dlg.addEventListener("close", function done() {
        dlg.removeEventListener("close", done);
        resolve(dlg.returnValue);
      });
      dlg.returnValue = "";
      dlg.showModal();
    });
  }

  // ============================================================ tabuleiro (desenho)
  const boardEl = $("board");
  const cells = [];
  for (let i = 0; i < 64; i++) {
    const cell = document.createElement("div");
    cell.addEventListener("click", () => onSquare(cellSquare(i)));
    boardEl.appendChild(cell);
    cells.push(cell);
  }
  function cellSquare(i) {
    const vr = Math.floor(i / 8), vc = i % 8;
    return flipped() ? [SIZE - 1 - vr, SIZE - 1 - vc] : [vr, vc];
  }

  function render() {
    const b = S.editing ? S.editBoard : board();
    const targets = new Set();
    const n = S.clicks.length;
    for (const m of candidates()) if (m.path.length > n + 1) targets.add(m.path[n + 1].join());
    const last = new Set();
    if (!S.editing && S.pos > 0) for (const sq of S.moves[S.pos - 1].path) last.add(sq.join());
    const picked = new Set(S.clicks.map(s => s.join()));
    if (S.selected) picked.add(S.selected.join());

    for (let i = 0; i < 64; i++) {
      const [r, c] = cellSquare(i), key = r + "," + c;
      const dark = (r + c) % 2 === 1;
      let cls = "sq " + (dark ? "d" : "l");
      if (picked.has(key)) cls += " sel";
      else if (last.has(key)) cls += " last";
      let html = "";
      if (i % 8 === 0) html += `<span class="coord r">${SIZE - r}</span>`;
      if (i >= 56) html += `<span class="coord c">${"abcdefgh"[c]}</span>`;
      const p = b.grid[r][c];
      if (p) html += `<div class="piece ${p > 0 ? "w" : "b"}${Math.abs(p) === KING ? " k" : ""}"></div>`;
      else if (targets.has(key)) html += `<div class="dot"></div>`;
      cells[i].className = cls;
      cells[i].innerHTML = html;
      cells[i].setAttribute("aria-label", `${"abcdefgh"[c]}${SIZE - r}`);
    }
    updateInfo();
  }

  function opponentText() {
    if (S.mode === "cpu") return `Computador (${S.level})`;
    if (S.mode === "tournament" && S.tournament) return `${OPPONENTS[S.tournament.round][0]} (${S.level})`;
    if (S.mode === "online") {
      const st = S.roomState;
      if (!st || !st.seats.white || !st.seats.black) return "aguardando…";
      return `${nameOf(st.seats.white)} × ${nameOf(st.seats.black)}`;
    }
    return "—";
  }

  function updateInfo() {
    const b = S.editing ? S.editBoard : board();
    const [wm, wk] = b.count(WHITE), [bm, bk] = b.count(BLACK);
    let mode = MODE_NAMES[S.mode];
    if (S.mode === "tournament" && S.tournament) mode += " — " + STAGES[S.tournament.round];
    if (S.mode === "online") {
      mode += S.seatColor === WHITE ? " — você: Brancas" : S.seatColor === BLACK ? " — você: Pretas" : " — assistindo";
    }
    $("i-mode").textContent = mode;
    $("i-opp").textContent = opponentText();
    $("i-rule").textContent = b.backCapture ? "Oficial" : "Sem iniciar captura para trás";
    $("i-time").textContent = formatTime(gameSeconds());
    $("i-white").textContent = `${wm} peças, ${wk} damas`;
    $("i-black").textContent = `${bm} peças, ${bk} damas`;

    const nav = canNavigate();
    $("btn-back").disabled = !nav || S.pos === 0;
    $("btn-fwd").disabled = !nav || atEnd();
    const offline = (S.mode === "cpu" || S.mode === "pvp") && !S.thinking;
    $("btn-save").disabled = !offline;
    $("btn-edit").disabled = !offline;
    const online = S.mode === "online";
    const playingOnline = online && S.roomState && S.roomState.phase === "playing";
    $("btn-resign").disabled = !(playingOnline && S.seatColor !== null && S.net);
    $("btn-share").hidden = !(online && S.net && S.net.isHost);
    renderRoom();

    if (performance.now() < S.flashUntil) return;
    let msg;
    if (S.editing) msg = "Editando o tabuleiro";
    else if (S.thinking) msg = `Computador pensando (${S.level})…`;
    else if (online) msg = onlineStatus();
    else if (S.gameOver) msg = "Fim de jogo — toque em Novo jogo";
    else {
      msg = `Vez das ${colorName(board().turn)}`;
      if (S.mode !== "pvp") msg += board().turn === S.humanColor ? " (você)" : "";
      if (!atEnd()) msg += " — revendo jogadas";
    }
    $("status").textContent = msg;
  }

  function flash(text, ms = 2500) {
    $("status").textContent = text;
    S.flashUntil = performance.now() + ms;
    setTimeout(updateInfo, ms + 20);
  }

  // ============================================================ partida
  function startGame(b, mode, humanColor = WHITE, level = null, moves = [], pos = null, elapsed = 0) {
    S.gameId++;
    S.mode = mode;
    S.humanColor = humanColor;
    if (level) S.level = level;
    S.states = [b];
    S.moves = [];
    for (const m of moves) { S.moves.push(m); S.states.push(S.states[S.states.length - 1].apply(m)); }
    S.pos = pos === null ? S.states.length - 1 : pos;
    S.thinking = false;
    S.gameOver = false;
    S.elapsed = elapsed;
    S.clockStart = performance.now();
    resetSelection();
    render();
    if (atEnd() && board().result() !== null) checkEnd(true);
    else maybeCpuTurn();
  }

  function resetSelection() { S.selected = null; S.clicks = []; }

  function humanCanMove() {
    if (S.gameOver || S.thinking || S.editing) return false;
    if (S.mode === "pvp") return true;
    if (S.mode === "online") {
      return !!S.net && S.netConnected && atEnd() && S.seatColor !== null && board().turn === S.seatColor;
    }
    if (S.mode === "tournament" && !atEnd()) return false;
    return board().turn === S.humanColor;
  }

  function candidates() {
    if (!S.selected) return [];
    const n = S.clicks.length, sel = S.selected.join(), prefix = S.clicks.map(s => s.join()).join("|");
    return board().legalMoves().filter(m => m.path[0].join() === sel &&
      m.path.slice(1, n + 1).map(s => s.join()).join("|") === prefix);
  }

  function onSquare(sq) {
    if (S.editing) return editPlace(sq);
    if (!humanCanMove()) return;
    const legal = board().legalMoves();
    const starts = new Set(legal.map(m => m.path[0].join()));
    const key = sq.join();
    if (starts.has(key) && !S.clicks.length) {
      S.selected = sq;
      return render();
    }
    if (!S.selected) {
      if (board().at(sq) * board().turn > 0 && legal.length && legal[0].captured.length) {
        flash("Captura obrigatória! Escolha uma peça que possa capturar.");
      }
      return;
    }
    const n = S.clicks.length;
    const options = candidates().filter(m => m.path.length > n + 1 && m.path[n + 1].join() === key);
    if (!options.length) {
      resetSelection();
      if (starts.has(key)) S.selected = sq;
      return render();
    }
    S.clicks.push(sq);
    const finished = options.filter(m => m.path.length === n + 2);
    if (finished.length) play(finished[0], true);
    else render();
  }

  function play(move, byHuman) {
    S.states.length = S.pos + 1;
    S.moves.length = S.pos;
    S.states.push(board().apply(move));
    S.moves.push(move);
    S.pos++;
    if (byHuman && S.mode === "online") {
      // O lance já aparece aqui; a sala valida e confirma (ou corrige) com o estado.
      if (S.room) S.room.hostMove(move.path);
      else if (S.net) S.net.send({ t: "move", path: move.path, n: S.moves.length - 1 });
    }
    soundMove(move);
    resetSelection();
    render();
    if (!checkEnd()) maybeCpuTurn();
  }

  // ------------------------------------------------------------ computador
  let worker = null, aiSeq = 0;
  try { worker = new Worker("ai-worker.js"); } catch (e) { worker = null; }
  const pendingAI = new Map(); // id -> { resolve, board, level }
  const thinkHere = (b, level) => new Promise(r => setTimeout(() => r(AI.chooseMove(b, level).path), 30));
  if (worker) {
    worker.onmessage = ({ data }) => {
      const req = pendingAI.get(data.id);
      pendingAI.delete(data.id);
      if (req) req.resolve(data.path);
    };
    worker.onerror = e => {
      // Sem o worker (ex.: página aberta como arquivo local), pensa na própria página.
      e.preventDefault();
      worker = null;
      for (const [id, req] of pendingAI) {
        pendingAI.delete(id);
        thinkHere(req.board, req.level).then(req.resolve);
      }
    };
  }
  function askAI(b, level) {
    if (!worker) return thinkHere(b, level);
    const id = ++aiSeq;
    return new Promise(resolve => {
      pendingAI.set(id, { resolve, board: b, level });
      worker.postMessage({ id, board: b.toJSON(), level });
    });
  }

  async function maybeCpuTurn() {
    const cpu = cpuColor();
    if (cpu === null || S.gameOver || board().turn !== cpu || !atEnd() || board().result() !== null) return;
    S.thinking = true;
    updateInfo();
    const gid = S.gameId, b = board();
    const started = performance.now();
    const path = await askAI(b, S.level);
    // Um respiro mínimo para o lance do computador não parecer instantâneo.
    const wait = Math.max(0, 350 - (performance.now() - started));
    await new Promise(r => setTimeout(r, wait));
    if (gid !== S.gameId) return; // jogo abandonado enquanto pensava
    S.thinking = false;
    const move = board().findMove(path);
    if (move) play(move, false);
  }

  // ------------------------------------------------------------ fim de jogo
  function checkEnd(quiet = false) {
    const result = board().result();
    if (result === null) return false;
    S.elapsed = gameSeconds();
    S.clockStart = null;
    S.gameOver = true;
    updateInfo();
    // Online, quem anuncia o fim (e a próxima partida) é a sala.
    if (!quiet && S.mode !== "online") setTimeout(() => announceEnd(result, S.gameId), 250);
    return true;
  }

  async function announceEnd(result, gid) {
    if (gid !== S.gameId) return;
    const humanWon = result !== 0 && result === S.humanColor;
    soundEnd(S.mode === "pvp" ? result !== 0 : humanWon);
    if (S.mode === "tournament") return finishTournamentGame(result);
    if (result === 0) return alertBox("Fim de jogo", "Empate!");
    if (S.mode === "pvp") return alertBox("Fim de jogo", `As ${colorName(result)} venceram!`);
    if (!humanWon) {
      return alertBox("Fim de jogo", S.mode === "cpu" ? "O computador venceu." : "Seu amigo venceu. Que tal uma revanche?");
    }
    const seconds = Math.floor(S.elapsed);
    await alertBox("Fim de jogo", `Você venceu em ${formatTime(seconds)}! 🎉`);
    if (S.mode === "cpu" && recordQualifies(S.level, seconds)) {
      const name = await promptBox("Records", "Você entrou na lista de records! Digite seu nome:", store.get("lastName", ""));
      if (name) {
        store.set("lastName", name);
        const place = addRecord(S.level, name.slice(0, 30), seconds);
        await alertBox("Records", `Você ficou em ${place}º lugar no nível ${S.level}.`);
        showRecords(S.level);
      }
    }
  }

  // ============================================================ records
  const loadRecords = () => {
    const r = store.get("records", {});
    return r && typeof r === "object" ? r : {};
  };
  function recordQualifies(level, seconds) {
    const table = loadRecords()[level] || [];
    return table.length < MAX_RECORDS || seconds < table[table.length - 1].seconds;
  }
  function addRecord(level, name, seconds) {
    const records = loadRecords();
    const table = records[level] || (records[level] = []);
    const entry = { name, seconds, date: nowText(), id: Math.random() };
    table.push(entry);
    table.sort((a, b) => a.seconds - b.seconds);
    table.length = Math.min(table.length, MAX_RECORDS);
    store.set("records", records);
    return table.indexOf(entry) + 1;
  }
  function fillRecords() {
    const level = $("records-level").value;
    const rows = (loadRecords()[level] || []).map((e, i) => {
      const tr = document.createElement("tr");
      for (const v of [i + 1, e.name, formatTime(e.seconds), e.date]) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      }
      return tr;
    });
    const body = $("records-body");
    body.innerHTML = rows.length ? "" : `<tr><td colspan="4" class="records-empty">Nenhum record ainda.</td></tr>`;
    rows.forEach(r => body.appendChild(r));
  }
  function showRecords(level) {
    $("records-level").value = level || S.level;
    fillRecords();
    return openDialog("dlg-records");
  }

  // ============================================================ navegação
  function goBack() {
    if (!canNavigate() || S.pos === 0) return;
    let target = S.pos - 1;
    const cpu = cpuColor();
    while (cpu !== null && target > 0 && S.states[target].turn === cpu) target--;
    if (cpu !== null && S.states[target].turn === cpu) return; // o computador começou
    goto(target);
  }
  function goForward() {
    if (!canNavigate() || atEnd()) return;
    let target = S.pos + 1;
    const cpu = cpuColor();
    while (cpu !== null && target < S.states.length - 1 && S.states[target].turn === cpu) target++;
    goto(target);
  }
  function goto(index) {
    S.pos = index;
    S.gameOver = atEnd() && board().result() !== null;
    if (!S.gameOver && S.clockStart === null) S.clockStart = performance.now();
    resetSelection();
    render();
  }

  // ============================================================ salvar / abrir
  function loadSlots() {
    const slots = store.get("saves", []);
    const list = Array.isArray(slots) ? slots : [];
    while (list.length < SAVE_SLOTS) list.push(null);
    return list.slice(0, SAVE_SLOTS);
  }

  function chooseSlot(saving) {
    const slots = loadSlots();
    $("slots-title").textContent = saving ? "Salvar jogo — escolha a posição" : "Abrir jogo";
    const list = $("slots-list");
    list.innerHTML = "";
    slots.forEach((slot, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.value = String(i);
      btn.textContent = slot ? `${i + 1}. ${slot.name} (${slot.date})` : `${i + 1}. (vazio)`;
      if (!slot) btn.classList.add("empty");
      if (!saving && !slot) btn.disabled = true;
      li.appendChild(btn);
      list.appendChild(li);
    });
    return openDialog("dlg-slots").then(v => (v === "" || v === "cancel" ? null : [Number(v), slots[Number(v)]]));
  }

  async function saveGame() {
    if (!(S.mode === "cpu" || S.mode === "pvp") || S.editing || S.thinking) return;
    const choice = await chooseSlot(true);
    if (!choice) return;
    const [index, slot] = choice;
    if (slot && !(await confirmBox("Salvar jogo", `Substituir "${slot.name}"?`))) return;
    const name = await promptBox("Salvar jogo", "Nome do jogo:", slot ? slot.name : `${MODE_NAMES[S.mode]} ${nowText()}`);
    if (!name) return;
    const slots = loadSlots();
    slots[index] = {
      name: name.slice(0, 40), date: nowText(),
      game: {
        mode: S.mode, human_color: S.humanColor, level: S.level, initial: S.states[0].toJSON(),
        moves: S.moves.map(m => m.path), pos: S.pos, elapsed: Math.floor(gameSeconds()),
      },
    };
    if (store.set("saves", slots)) flash("Jogo salvo.");
    else alertBox("Salvar", "Não foi possível salvar (armazenamento do navegador indisponível).");
  }

  async function openGame() {
    if (S.editing || S.thinking) return;
    const choice = await chooseSlot(false);
    if (!choice || !choice[1]) return;
    const game = choice[1].game;
    try {
      const b = Board.fromJSON(game.initial);
      const moves = [];
      let cur = b;
      for (const path of game.moves) {
        const m = cur.findMove(path);
        if (!m) throw new Error("jogada inválida no arquivo");
        moves.push(m);
        cur = cur.apply(m);
      }
      const level = AI.LEVELS[game.level] ? game.level : AI.DEFAULT_LEVEL;
      const mode = game.mode === "cpu" ? "cpu" : "pvp";
      const pos = Math.max(0, Math.min(Number(game.pos) || 0, moves.length));
      closeNet();
      S.tournament = null;
      startGame(b, mode, game.human_color === BLACK ? BLACK : WHITE, level, moves, pos, Number(game.elapsed) || 0);
      flash(`Jogo "${choice[1].name}" aberto.`);
    } catch (e) {
      alertBox("Abrir", "Jogo salvo corrompido: " + e.message);
    }
  }

  // ============================================================ editar
  function startEdit() {
    if (!(S.mode === "cpu" || S.mode === "pvp") || S.thinking) return;
    S.editing = true;
    S.editBoard = board().copy();
    $("edit-turn").value = String(S.editBoard.turn);
    $("play-box").hidden = true;
    $("edit-box").hidden = false;
    resetSelection();
    render();
  }
  function editPlace([r, c]) {
    if ((r + c) % 2 === 0) return;
    const piece = Number(document.querySelector('input[name="piece"]:checked').value);
    const b = S.editBoard.copy(); // nova instância: o cache de lances não fica velho
    if (b.grid[r][c] === piece) b.grid[r][c] = 0; // tocar de novo apaga
    else if (Math.abs(piece) === MAN && r === (piece > 0 ? 0 : SIZE - 1)) {
      return flash("Peça simples não pode ficar na fileira de promoção — use uma dama.");
    } else b.grid[r][c] = piece;
    S.editBoard = b;
    render();
  }
  function finishEdit() {
    const b = S.editBoard.copy();
    if (!b.count(WHITE).some(Boolean) || !b.count(BLACK).some(Boolean)) {
      return alertBox("Editar tabuleiro", "Coloque pelo menos uma peça de cada cor.");
    }
    b.turn = Number($("edit-turn").value) === BLACK ? BLACK : WHITE;
    b.quiet = 0;
    leaveEdit();
    startGame(b, S.mode, S.humanColor, S.level);
  }
  function leaveEdit() {
    S.editing = false;
    $("edit-box").hidden = true;
    $("play-box").hidden = false;
  }

  // ============================================================ torneio
  async function startTournamentRound() {
    const t = S.tournament;
    const [name, level] = OPPONENTS[t.round];
    const color = t.round % 2 === 0 ? WHITE : BLACK;
    await alertBox("Torneio", `${STAGES[t.round]} (${t.round + 1} de ${OPPONENTS.length})\n` +
      `Adversário: ${name} — nível ${level}\nVocê joga com as ${colorName(color)}.`);
    startGame(Board.initial(S.tournamentBack), "tournament", color, level);
  }
  async function finishTournamentGame(result) {
    const t = S.tournament;
    if (result === 0) {
      await alertBox("Torneio", "Empate! A partida será repetida.");
      return startTournamentRound();
    }
    if (result !== S.humanColor) {
      return alertBox("Torneio", `Você foi eliminado na ${STAGES[t.round]} por ${OPPONENTS[t.round][0]}.\nTente novamente!`);
    }
    if (t.round === OPPONENTS.length - 1) {
      return alertBox("Torneio", "🏆 Parabéns! Você é o CAMPEÃO do torneio!");
    }
    t.round++;
    await alertBox("Torneio", "Vitória! Você avançou para a próxima fase.");
    startTournamentRound();
  }

  // ============================================================ online (sala com fila)
  // Identidade deste aparelho: o id identifica, a chave secreta prova que é a
  // mesma pessoa numa reconexão (outro aparelho com o link não pega o lugar).
  const me = (() => {
    let v = store.get("me", null);
    if (!v || !v.id || !v.secret) {
      const r = DamasNet.randomCode;
      v = { id: r() + r(), secret: r() + r() + r() + r() };
      store.set("me", v);
    }
    return v;
  })();

  const nameOf = id => {
    const m = S.roomState && S.roomState.members.find(x => x.id === id);
    return m ? m.name : "—";
  };

  function closeNet() {
    if (S.room) S.room.close();
    if (S.net) S.net.close();
    S.room = null;
    S.net = null;
    S.roomState = null;
    S.seatColor = null;
    S.netConnected = false;
    S.netWaiting = false;
  }

  async function askName(force = false) {
    const saved = store.get("lastName", "");
    if (saved && !force) return saved;
    const typed = await promptBox("Seu nome", "Como você quer aparecer para os outros jogadores?", saved);
    if (typed === null) return saved || DamasRoom.cleanName("");
    const clean = DamasRoom.cleanName(typed);
    store.set("lastName", clean);
    return clean;
  }

  // ------------------------------------------------------------ anfitrião
  async function hostOnline(cfg) {
    closeNet();
    S.tournament = null;
    S.joinCode = null;
    const name = await askName(true);
    const net = new DamasNet.NetSession({
      onReady: () => { S.netWaiting = true; fillInvite(); updateInfo(); },
      onPeerOpen: () => {},
      onPeerData: (conn, msg) => roomMessage(conn, msg),
      onPeerClose: conn => S.room && S.room.disconnected(conn),
      onError: text => {
        if ($("dlg-invite").open) $("dlg-invite").close();
        closeNet();
        updateInfo();
        alertBox("Partida online", text);
      },
    });
    S.net = net;
    S.netConnected = true; // o anfitrião é a própria sala
    S.room = new DamasRoom.Room({
      hostId: me.id, hostName: name, hostColor: cfg.color, backCapture: cfg.back,
      send: (conn, msg) => net.sendTo(conn, msg),
      close: conn => net.closeConn(conn),
      onChange: applyRoomState,
    });
    applyRoomState(S.room.stateFor(me.id));
    net.host();
    $("invite-state").textContent = "Criando a sala…";
    $("invite-ready").hidden = true;
    openDialog("dlg-invite");
  }

  function roomMessage(conn, msg) {
    const room = S.room;
    if (!room) return;
    if (msg.t === "join") room.join(conn, msg);
    else if (msg.t === "move") room.move(conn, msg);
    else if (msg.t === "resign") room.resign(conn);
    else if (msg.t === "leave") room.leave(conn);
    else if (msg.t === "rename") room.rename(conn, msg.name);
  }

  function fillInvite() {
    if (!S.net || !S.net.code) return;
    const url = S.net.inviteUrl();
    const text = `Bora jogar Damas Jeff? Toque no link para entrar na sala: ${url}`;
    $("invite-state").textContent = "Sala criada!";
    $("invite-ready").hidden = false;
    $("invite-link").value = url;
    $("invite-whats").href = "https://wa.me/?text=" + encodeURIComponent(text);
    const native = $("invite-native");
    native.hidden = !navigator.share;
    native.onclick = () => navigator.share({ title: "Damas Jeff", text, url }).catch(() => {});
  }

  // ------------------------------------------------------------ convidado
  async function joinOnline(code) {
    closeNet();
    S.tournament = null;
    S.joinCode = code;
    S.denied = false;
    startGame(Board.initial(), "online", WHITE);
    S.gameOver = true;
    S.clockStart = null;
    const name = await askName();
    const net = new DamasNet.NetSession({
      onConnected: () => {
        S.netConnected = true;
        net.send({ t: "join", v: DamasRoom.PROTOCOL, id: me.id, secret: me.secret, name });
        flash("Conectado! Entrando na sala…");
      },
      onMessage: msg => {
        if (msg.t === "state") applyRoomState(msg);
        else if (msg.t === "denied") {
          S.denied = true;
          closeNet();
          updateInfo();
          alertBox("Partida online", msg.reason);
        }
      },
      onDisconnected: () => { if (!S.denied) offerReconnect("A conexão com a sala caiu."); },
      onError: text => { if (!S.denied) offerReconnect(text); },
    });
    S.net = net;
    net.join(code);
    flash("Conectando à sala…", 25000);
  }

  async function offerReconnect(text) {
    const code = S.joinCode;
    closeNet();
    S.gameOver = true;
    S.clockStart = null;
    updateInfo();
    if (!code) return alertBox("Partida online", text);
    if (await confirmBox("Partida online", text + "\n\nTentar conectar de novo?", "Reconectar", "Agora não")) {
      joinOnline(code);
    }
  }

  // ------------------------------------------------------------ estado da sala
  function applyRoomState(st) {
    const prev = S.roomState;
    S.roomState = st;
    S.nextAtLocal = st.nextIn === null ? null : performance.now() + st.nextIn;
    const myColor = st.seats.white === st.you ? WHITE : st.seats.black === st.you ? BLACK : null;
    S.seatColor = myColor;
    const g = st.game;
    const view = myColor || WHITE; // espectador vê pelo lado das Brancas

    if (!g) {
      S.gameNo = 0;
      if (S.mode !== "online" || !prev || prev.game) startGame(Board.initial(st.backCapture), "online", view);
      else S.humanColor = view;
    } else if (S.mode === "online" && S.gameNo === g.no && sameMoves(g.moves)) {
      S.humanColor = view;
      for (let i = S.moves.length; i < g.moves.length; i++) {
        const move = S.states[S.states.length - 1].findMove(g.moves[i]);
        if (!move) return rebuildFrom(st);
        S.pos = S.states.length - 1;
        S.states.push(board().apply(move));
        S.moves.push(move);
        S.pos++;
        soundMove(move);
      }
    } else {
      rebuildFrom(st);
    }

    const playing = st.phase === "playing";
    S.gameOver = !playing;
    if (playing && S.clockStart === null) S.clockStart = performance.now();
    if (!playing && S.clockStart !== null) { S.elapsed = gameSeconds(); S.clockStart = null; }
    if (!playing) resetSelection();

    announceRoomChange(prev, st);
    render();
  }

  function sameMoves(paths) {
    if (S.moves.length > paths.length) return false;
    return S.moves.every((m, i) => moveKey(m.path) === moveKey(paths[i]));
  }

  function rebuildFrom(st) {
    const g = st.game;
    try {
      const b = Board.fromJSON(g.initial);
      const moves = [];
      let cur = b;
      for (const path of g.moves) {
        const m = cur.findMove(path);
        if (!m) throw new Error("lance inválido");
        moves.push(m);
        cur = cur.apply(m);
      }
      S.gameNo = g.no;
      startGame(b, "online", S.seatColor || WHITE, null, moves);
    } catch (e) {
      alertBox("Partida online", "O tabuleiro recebido está inválido. Recarregue a página.");
    }
  }

  function announceRoomChange(prev, st) {
    const g = st.game;
    const pg = prev && prev.game;
    // Fim de partida
    if (g && g.result !== null && !(pg && pg.no === g.no && pg.result !== null)) {
      const w = st.seats.white, b = st.seats.black;
      let text;
      if (g.result === 0) text = "Empate!";
      else text = `${nameOf(g.result === WHITE ? w : b)} venceu!`;
      if (g.reason && g.reason !== "empate") text += ` (${g.reason})`;
      S.endText = text;
      if (S.seatColor !== null) soundEnd(g.result === S.seatColor);
      else beep(600, 120);
    }
    // Começo de partida
    if (g && st.phase === "playing" && !(pg && pg.no === g.no)) {
      // Primeira partida da sala: o convite aberto automaticamente já cumpriu seu papel.
      if (S.room && g.no === 1 && $("dlg-invite").open) $("dlg-invite").close();
      const table = `${nameOf(st.seats.white)} (Brancas) × ${nameOf(st.seats.black)} (Pretas)`;
      let text = `Nova partida: ${table}.`;
      if (S.seatColor !== null) text += ` Você joga com as ${colorName(S.seatColor)}.`;
      else {
        const pos = st.queue.indexOf(st.you);
        if (pos >= 0) text += ` Você é o ${pos + 1}º da fila — assistindo.`;
      }
      flash(text, 5000);
      if (S.seatColor !== null && (!prev || prev.seats.white !== st.you && prev.seats.black !== st.you)) beep(880, 150);
    }
  }

  function renderRoom() {
    const st = S.roomState;
    const box = $("room-box");
    box.hidden = !(S.mode === "online" && st);
    if (box.hidden) return;
    const tag = id => {
      const m = st.members.find(x => x.id === id);
      let t = m ? m.name : "—";
      if (id === st.you) t += " (você)";
      if (m && !m.connected) t += " — caiu, aguardando";
      return t;
    };
    $("room-white").textContent = st.seats.white ? tag(st.seats.white) : "lugar vago";
    $("room-black").textContent = st.seats.black ? tag(st.seats.black) : "lugar vago";
    const list = $("room-queue");
    list.innerHTML = "";
    for (const id of st.queue) {
      const li = document.createElement("li");
      li.textContent = tag(id);
      if (id === st.you) li.className = "me";
      list.appendChild(li);
    }
    $("room-queue-empty").hidden = st.queue.length > 0;
  }

  function onlineStatus() {
    const st = S.roomState;
    if (!S.net) return "Sem conexão com a sala — toque em Novo jogo";
    if (!st) return S.net.isHost ? "Criando a sala…" : "Conectando à sala…";
    if (st.phase === "over") {
      const secs = S.nextAtLocal === null ? 0 : Math.max(0, Math.ceil((S.nextAtLocal - performance.now()) / 1000));
      return `${S.endText || "Fim de partida."} Próxima partida em ${secs}s…`;
    }
    if (st.phase === "waiting") {
      return st.members.length < 2 ? "Aguardando alguém abrir o link…" : "Aguardando mais um jogador…";
    }
    const turn = board().turn;
    const who = nameOf(turn === WHITE ? st.seats.white : st.seats.black);
    if (S.seatColor === null) {
      const pos = st.queue.indexOf(st.you);
      return `Assistindo — vez de ${who}` + (pos >= 0 ? ` · você é o ${pos + 1}º da fila` : "");
    }
    return turn === S.seatColor ? "Sua vez!" : `Vez de ${who}`;
  }

  function leaveOnline() {
    const net = S.net;
    if (net && !net.isHost) {
      net.send({ t: "leave" });
      net.closed = true;              // não avisa "conexão caiu" por esta saída
      S.net = null;
      setTimeout(() => { net.closed = false; net.close(); }, 400); // dá tempo do aviso chegar
    }
    closeNet();
  }

  // ============================================================ novo jogo
  async function newGame(presetMode) {
    if (S.editing) leaveEdit();
    if (S.mode === "online" && S.net) {
      const others = S.roomState ? S.roomState.members.length - 1 : 0;
      const ask = S.net.isHost
        ? (others > 0 ? `Sair fecha a sala para todos (${others} pessoa${others > 1 ? "s" : ""}). Continuar?` : null)
        : (S.seatColor !== null && !S.gameOver ? "Sair agora conta como derrota. Continuar?" : null);
      if (ask && !(await confirmBox("Novo jogo", ask))) return;
    }
    const form = $("dlg-new").querySelector("form");
    const cfg = Object.assign({}, S.lastCfg, presetMode ? { mode: presetMode } : {});
    form.mode.value = cfg.mode;
    form.level.value = cfg.level;
    form.color.value = String(cfg.color);
    form.back.checked = cfg.back;
    syncNewForm();
    if ((await openDialog("dlg-new")) !== "ok") return;
    const chosen = {
      mode: form.mode.value, level: form.level.value,
      color: Number(form.color.value) === BLACK ? BLACK : WHITE, back: form.back.checked,
    };
    S.lastCfg = chosen;
    store.set("lastCfg", chosen);
    if (S.mode === "online") leaveOnline();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    S.tournament = null;
    if (chosen.mode === "cpu") startGame(Board.initial(chosen.back), "cpu", chosen.color, chosen.level);
    else if (chosen.mode === "pvp") startGame(Board.initial(chosen.back), "pvp");
    else if (chosen.mode === "tournament") {
      S.tournament = { round: 0 };
      S.tournamentBack = chosen.back;
      startTournamentRound();
    } else hostOnline(chosen);
  }

  function syncNewForm() {
    const form = $("dlg-new").querySelector("form");
    const mode = form.mode.value;
    $("f-cpu").disabled = !(mode === "cpu" || mode === "online");
    $("row-level").style.display = mode === "online" ? "none" : "";
  }

  // ============================================================ eventos
  $("btn-new").onclick = () => newGame();
  $("btn-invite").onclick = () => newGame("online");
  $("btn-back").onclick = goBack;
  $("btn-fwd").onclick = goForward;
  $("btn-save").onclick = saveGame;
  $("btn-open").onclick = openGame;
  $("btn-edit").onclick = startEdit;
  $("btn-records").onclick = () => showRecords();
  $("btn-rules").onclick = () => alertBox("Regras", RULES);
  $("btn-share").onclick = () => { fillInvite(); openDialog("dlg-invite"); };
  $("btn-resign").onclick = async () => {
    if (!(await confirmBox("Desistir", "Desistir desta partida?"))) return;
    if (S.room) S.room.hostResign();
    else if (S.net) S.net.send({ t: "resign" });
  };
  $("btn-rename").onclick = async () => {
    const name = await askName(true);
    if (S.room) S.room.hostRename(name);
    else if (S.net) S.net.send({ t: "rename", name });
  };
  $("btn-sound").onclick = () => {
    S.sound = !S.sound;
    store.set("sound", S.sound);
    $("btn-sound").textContent = S.sound ? "🔊" : "🔇";
    $("btn-sound").setAttribute("aria-label", S.sound ? "Som ligado" : "Som desligado");
  };
  $("btn-sound").textContent = S.sound ? "🔊" : "🔇";
  $("edit-clear").onclick = () => {
    S.editBoard = Board.empty(Number($("edit-turn").value), S.editBoard.backCapture);
    render();
  };
  $("edit-reset").onclick = () => {
    S.editBoard = Board.initial(S.editBoard.backCapture);
    $("edit-turn").value = "1";
    render();
  };
  $("edit-done").onclick = finishEdit;
  $("edit-cancel").onclick = () => { leaveEdit(); render(); };
  $("records-level").onchange = fillRecords;
  $("dlg-new").querySelectorAll('input[name="mode"]').forEach(r => (r.onchange = syncNewForm));
  $("invite-copy").onclick = async () => {
    const link = $("invite-link");
    try { await navigator.clipboard.writeText(link.value); }
    catch (e) { link.select(); document.execCommand("copy"); }
    $("invite-copy").textContent = "Copiado!";
    setTimeout(() => ($("invite-copy").textContent = "Copiar link"), 2000);
  };
  document.addEventListener("keydown", e => {
    if (document.querySelector("dialog[open]")) return;
    if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); goBack(); }
    if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); goForward(); }
  });
  window.addEventListener("beforeunload", e => {
    const hostWithGuests = S.room && S.roomState && S.roomState.members.length > 1;
    const playing = S.mode === "online" && S.seatColor !== null && !S.gameOver;
    if (hostWithGuests || playing) { e.preventDefault(); e.returnValue = ""; }
  });
  setInterval(() => {
    if (S.clockStart !== null) $("i-time").textContent = formatTime(gameSeconds());
    // Contagem regressiva para a próxima partida da sala.
    if (S.mode === "online" && S.roomState && S.roomState.phase === "over") updateInfo();
  }, 500);

  const RULES = `• Tabuleiro 8x8; as Brancas começam.
• Peças simples andam uma casa na diagonal para frente.
• A captura é obrigatória; peças simples capturam para frente e para trás, em sequência. (Na variante opcional, a peça simples não pode iniciar a captura para trás.)
• Lei da maioria: é obrigatório fazer a jogada que captura o maior número de peças.
• A peça que termina o lance na última fileira vira dama, que anda e captura à distância.
• Vence quem capturar ou bloquear todas as peças do adversário.
• Empate: 20 lances seguidos de cada lado só com damas e sem captura.

Como jogar: toque numa peça e depois na casa de destino (os pontos verdes mostram as opções). Em capturas múltiplas, toque nas casas de pouso uma a uma.`;

  // ============================================================ início
  function codeFromHash() {
    const m = /jogo=([a-z0-9]{6})/i.exec(location.hash);
    return m ? m[1].toLowerCase() : null;
  }
  window.addEventListener("hashchange", () => {
    const code = codeFromHash();
    if (code && code !== S.joinCode) joinOnline(code);
  });

  render();
  const code = codeFromHash();
  if (code) joinOnline(code);
  else newGame();

  // Ganchos para testes automatizados.
  window.__damas = { S, startGame, play, onSquare, board, goBack, goForward, askAI };
})();
