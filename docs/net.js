/* Damas Jeff — partida entre dois aparelhos via PeerJS (WebRTC).
 * O servidor público do PeerJS só apresenta um aparelho ao outro;
 * as jogadas trafegam direto entre os dois navegadores.
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
    "peer-unavailable": "A partida não foi encontrada. O link pode ter expirado ou quem convidou fechou a página. Peça um novo link.",
    "network": "Sem conexão com a internet ou com o servidor de partidas.",
    "server-error": "O servidor de partidas não respondeu. Tente de novo em instantes.",
    "socket-error": "O servidor de partidas não respondeu. Tente de novo em instantes.",
    "socket-closed": "A conexão com o servidor de partidas caiu.",
    "browser-incompatible": "Este navegador não suporta partidas online. Use o Chrome, Safari ou Firefox atualizado.",
    "webrtc": "Não foi possível ligar os dois aparelhos. Tentem os dois no mesmo Wi-Fi ou outra rede.",
  };

  /**
   * Anfitrião (sala): onReady(code), onPeerOpen(conn), onPeerData(conn, msg),
   *                   onPeerClose(conn), onError(texto)
   * Convidado:        onConnected(), onMessage(msg), onDisconnected(), onError(texto)
   */
  class NetSession {
    constructor(handlers) {
      this.h = handlers;
      this.peer = null;
      this.conn = null; // convidado: conexão com o anfitrião
      this.isHost = false;
      this.code = null;
      this.closed = false;
      this._timer = null;
    }

    host() {
      if (typeof Peer === "undefined") return this._fail("browser-incompatible");
      this.isHost = true;
      this.code = randomCode();
      this.peer = new Peer(PREFIX + this.code, { debug: 0 });
      this.peer.on("open", () => this.h.onReady(this.code));
      this.peer.on("connection", conn => {
        let gone = false;
        const bye = () => { if (!gone && !this.closed) { gone = true; this.h.onPeerClose(conn); } };
        conn.on("open", () => this.h.onPeerOpen(conn));
        conn.on("data", msg => { if (msg && typeof msg === "object") this.h.onPeerData(conn, msg); });
        conn.on("close", bye);
        conn.on("error", bye);
      });
      this._watchPeer();
    }

    sendTo(conn, msg) {
      if (conn && conn.open) conn.send(msg);
    }

    closeConn(conn) {
      // Dá tempo da última mensagem (ex.: o motivo da recusa) chegar.
      if (conn) setTimeout(() => conn.close(), 400);
    }

    join(code) {
      if (typeof Peer === "undefined") return this._fail("browser-incompatible");
      this.isHost = false;
      this.code = code;
      this.peer = new Peer({ debug: 0 });
      this.peer.on("open", () => {
        this._attach(this.peer.connect(PREFIX + code, { reliable: true }));
      });
      this._watchPeer();
      this._timer = setTimeout(() => {
        if (!this.conn || !this.conn.open) this._fail("webrtc");
      }, CONNECT_TIMEOUT_MS);
    }

    _watchPeer() {
      this.peer.on("error", err => {
        if (err.type === "unavailable-id" && this.isHost) {
          // Código já em uso (raríssimo): tenta outro.
          this.peer.destroy();
          return this.host();
        }
        this._fail(err.type);
      });
      this.peer.on("disconnected", () => {
        // Perder o servidor não derruba a partida já conectada; tenta voltar.
        if (!this.closed && !this.peer.destroyed) this.peer.reconnect();
      });
    }

    _attach(conn) {
      this.conn = conn;
      conn.on("open", () => {
        clearTimeout(this._timer);
        this.h.onConnected();
      });
      conn.on("data", msg => {
        if (msg && typeof msg === "object") this.h.onMessage(msg);
      });
      conn.on("close", () => {
        if (this.conn === conn && !this.closed) this.h.onDisconnected();
      });
      conn.on("error", () => {
        if (this.conn === conn && !this.closed) this.h.onDisconnected();
      });
    }

    _fail(type) {
      if (this.closed) return;
      clearTimeout(this._timer);
      this.h.onError(ERRORS[type] || `Erro de conexão (${type}).`);
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

    inviteUrl() {
      const url = new URL(location.href);
      url.search = "";
      url.hash = "jogo=" + this.code;
      return url.toString();
    }

    close() {
      this.closed = true;
      clearTimeout(this._timer);
      if (this.peer && !this.peer.destroyed) this.peer.destroy();
    }
  }

  root.DamasNet = { NetSession, randomCode };
})(typeof self !== "undefined" ? self : globalThis);
