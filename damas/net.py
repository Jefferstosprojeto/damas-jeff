"""Partidas em rede local / internet por conexão TCP direta (IP)."""

from __future__ import annotations

import json
import queue
import socket
import threading

DEFAULT_PORT = 5577
PROTOCOL = 1


def local_ip() -> str:
    """IP desta máquina na rede local (nenhum pacote é enviado)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class NetLink:
    """Conexão com o adversário. Eventos chegam em `inbox` como (tipo, dado):
    ("connected", endereço), ("msg", dict), ("closed", motivo), ("error", texto).
    """

    def __init__(self) -> None:
        self.inbox: queue.Queue = queue.Queue()
        self.sock: socket.socket | None = None
        self._server: socket.socket | None = None
        self._closed = threading.Event()
        self._send_lock = threading.Lock()

    # ---------------------------------------------------------------- conexão
    def host(self, port: int = DEFAULT_PORT) -> None:
        try:
            self._server = socket.create_server(("", port))
        except OSError as exc:
            raise OSError(f"Não foi possível abrir a porta {port}: {exc}") from exc
        self._server.settimeout(0.5)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self._closed.is_set():
            try:
                conn, addr = self._server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            self._server.close()
            self._attach(conn, addr[0])
            return

    def join(self, ip: str, port: int = DEFAULT_PORT) -> None:
        def run():
            try:
                conn = socket.create_connection((ip, port), timeout=10)
            except OSError as exc:
                self.inbox.put(("error", f"Não foi possível conectar em {ip}:{port}.\n{exc}"))
                return
            self._attach(conn, ip)
        threading.Thread(target=run, daemon=True).start()

    def _attach(self, conn: socket.socket, peer: str) -> None:
        conn.settimeout(None)
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.sock = conn
        self.inbox.put(("connected", peer))
        reason = "O adversário saiu da partida."
        try:
            with conn.makefile("r", encoding="utf-8") as stream:
                for line in stream:
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(msg, dict):
                        self.inbox.put(("msg", msg))
        except OSError:
            reason = "A conexão com o adversário caiu."
        if not self._closed.is_set():
            self.inbox.put(("closed", reason))

    # ---------------------------------------------------------------- envio
    def send(self, msg: dict) -> bool:
        if self.sock is None:
            return False
        data = (json.dumps(msg) + "\n").encode("utf-8")
        try:
            with self._send_lock:
                self.sock.sendall(data)
            return True
        except OSError:
            return False

    def close(self) -> None:
        self._closed.set()
        for s in (self._server, self.sock):
            if s is None:
                continue
            # shutdown() encerra a conexão mesmo com o leitor (makefile) ainda
            # segurando uma referência ao socket; close() sozinho não encerraria.
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass
