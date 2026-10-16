/* Damas Jeff — ligação com a sala online via PeerJS (WebRTC).
 * O servidor público do PeerJS só apresenta um aparelho ao outro;
 * as jogadas trafegam direto entre os navegadores.
 */
(function (root) {
  "use strict";

  const PREFIX = "damasjeff-";
  const CONNECT_TIMEOUT_MS = 25000;

  function randomCode() {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // sem letras/números parecidos
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => chars[b % chars.length]).join("");
  }

  const ERRORS = {
    "network": "Sem conexão com a internet ou com o servidor de partidas.",
    "server-error": "O servidor de partidas não respondeu. Tente de novo em instantes.",
    "socket-error": "O servidor de partidas não respondeu. Tente de novo em instantes.",
    "socket-closed": "A conexão com o servidor de partidas caiu.",
    "browser-incompatible": "Este navegador não suporta partidas online. Use o Chrome, Safari ou Firefox atualizado.",
    "webrtc": "Não foi possível ligar os dois aparelhos. Tentem os dois no mesmo Wi-Fi ou outra rede.",
  };

  // A sala única e fixa do jogo. (?sala=nome só serve para testes, sem
  // ocupar a sala de verdade.)
  const TEST_ROOM = typeof location !== "undefined"
    ? (new URLSearchParams(location.search).get("sala") || "").replace(/[^a-z0-9]/gi, "").slice(0, 20)
    : "";
  const ROOM_ID = PREFIX + "sala" + (TEST_ROOM ? "-" + TEST_ROOM : "");
  const KEEPALIVE_MS = 4000;

  /**
   * Ligação com a sala fixa. Cada aparelho primeiro tenta "segurar" a sala
   * (registrar o id fixo no servidor do PeerJS); se alguém já segura, entra
   * nela como convidado. Se a ligação cair ou a sala sumir, repete sozinho:
   * assim a sala existe enquanto houver alguém com a página aberta.
   *
   * Handlers — anfitrião: onHost(), onHostLost(), onPeerData(conn, msg), onPeerClose(conn)
   *            convidado: onConnected(), onMessage(msg), onDisconnected()
   *            ambos:     onSearching(tipo, falhas), onFatal(texto)
   */
  class RoomLink {
    constructor(handlers) {
      this.h = handlers;
      this.peer = null;
      this.conn = null; // convidado: conexão com o anfitrião
      this.isHost = false;
      this.closed = false;
      this.failures = 0;
      this._timer = null;
      this._retryTimer = null;
      this._keep = null;
      this._onVisible = () => { if (!document.hidden) this._keepAlive(); };
    }

    _emit(name, ...args) {
      if (!this.closed && this.h[name]) this.h[name](...args);
    }

    start() {
      if (typeof Peer === "undefined") return this._emit("onFatal", ERRORS["browser-incompatible"]);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVisible);
      this._claim();
    }

    // ------------------------------------------------------------ segurar a sala
    _claim() {
      this._reset();
      const peer = this.peer = new Peer(ROOM_ID, { debug: 0 });
      peer.on("open", () => {
        if (peer !== this.peer || this.closed) return;
        this.isHost = true;
        this.failures = 0;
        this._keep = setInterval(() => this._keepAlive(), KEEPALIVE_MS);
        this._emit("onHost");
      });
      peer.on("connection", conn => {
        if (peer !== this.peer || !this.isHost) return conn.close();
        let gone = false;
        const bye = () => {
          if (!gone && peer === this.peer) { gone = true; this._emit("onPeerClose", conn); }
        };
        conn.on("data", msg => {
          if (peer === this.peer && msg && typeof msg === "object") this._emit("onPeerData", conn, msg);
        });
        conn.on("close", bye);
        conn.on("error", bye);
      });
      peer.on("error", err => {
        if (peer !== this.peer || this.closed) return;
        if (err.type === "unavailable-id") {
          // Já tem alguém segurando a sala (ou, se éramos nós, outro assumiu
          // enquanto este aparelho estava sem servidor): entra como convidado.
          if (this.isHost) { this.isHost = false; this._emit("onHostLost"); }
          this._join();
        } else if (!this.isHost) {
          this._retry(err.type);
        }
        // Anfitrião: perder o servidor não derruba quem já está na sala;
        // _keepAlive tenta voltar.
      });
    }

    /** Anfitrião sem o servidor do PeerJS (ex.: celular em segundo plano):
     *  volta a registrar a sala para que novas pessoas consigam entrar. */
    _keepAlive() {
      const peer = this.peer;
      if (!this.isHost || !peer || peer.destroyed || this.closed) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* tenta no próximo ciclo */ } }
    }

    // ------------------------------------------------------------ entrar na sala
    _join() {
      this._reset();
      this.isHost = false;
      const peer = this.peer = new Peer({ debug: 0 });
      peer.on("open", () => {
        if (peer === this.peer && !this.closed) this._attach(peer.connect(ROOM_ID, { reliable: true }));
      });
      peer.on("error", err => {
        if (peer === this.peer && !this.closed) this._retry(err.type);
      });
      this._timer = setTimeout(() => {
        if (peer === this.peer && !(this.conn && this.conn.open)) this._retry("webrtc");
      }, CONNECT_TIMEOUT_MS);
    }

    _attach(conn) {
      this.conn = conn;
      let opened = false;
      conn.on("open", () => {
        if (this.conn !== conn) return;
        opened = true;
        clearTimeout(this._timer);
        this.failures = 0;
        this._emit("onConnected");
      });
      conn.on("data", msg => {
        if (this.conn === conn && msg && typeof msg === "object") this._emit("onMessage", msg);
      });
      const lost = () => {
        if (this.conn !== conn || this.closed) return;
        this.conn = null;
        if (opened) this._emit("onDisconnected");
        this._retry(opened ? "lost" : "webrtc");
      };
      conn.on("close", lost);
      conn.on("error", lost);
    }

    // ------------------------------------------------------------ repetir
    _retry(type) {
      if (this.closed) return;
      this._reset();
      // "peer-unavailable": a sala acabou de ficar vazia — tenta segurá-la logo,
      // com um sorteio para que duas pessoas não disputem ao mesmo tempo.
      const quick = type === "peer-unavailable" || type === "lost";
      if (!quick) this.failures++;
      this._emit("onSearching", type, this.failures);
      const delay = quick
        ? 300 + Math.random() * 1500
        : Math.min(15000, 2000 * this.failures) + Math.random() * 1000;
      this._retryTimer = setTimeout(() => this._claim(), delay);
    }

    _reset() {
      clearTimeout(this._timer);
      clearTimeout(this._retryTimer);
      clearInterval(this._keep);
      this._keep = null;
      const peer = this.peer;
      this.peer = null;
      this.conn = null;
      this.isHost = false;
      if (peer && !peer.destroyed) peer.destroy();
    }

    // ------------------------------------------------------------ envio
    sendTo(conn, msg) {
      if (conn && conn.open) conn.send(msg);
    }

    closeConn(conn) {
      // Dá tempo da última mensagem (ex.: o motivo da recusa) chegar.
      if (conn) setTimeout(() => conn.close(), 400);
    }

    get connected() {
      return !!(this.conn && this.conn.open);
    }

    send(msg) {
      if (this.connected) {
        this.conn.send(msg);
        return true;
      }
      return false;
    }

    /** Para de avisar a tela; a ligação continua até close() (dá tempo da
     *  última mensagem sair). */
    mute() {
      this.h = {};
    }

    close() {
      this.closed = true;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this._onVisible);
      this._reset();
    }
  }

  function roomUrl() {
    const url = new URL(location.href);
    url.search = TEST_ROOM ? "?sala=" + TEST_ROOM : "";
    url.hash = "sala";
    return url.toString();
  }

  root.DamasNet = { RoomLink, roomUrl, randomCode };
})(typeof self !== "undefined" ? self : globalThis);
