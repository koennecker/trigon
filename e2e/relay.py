#!/usr/bin/env python3
"""Local relay proxy for Chromium: injects Proxy-Authorization preemptively.

Chromium's own 407 handshake fails against the sandbox egress proxy
(ERR_EMPTY_RESPONSE); this relay adds the header up front and forwards
everything (plain HTTP and CONNECT tunnels) to the upstream proxy.
Reads credentials fresh from the environment on every request (they rotate).
"""

import base64
import os
import socket
import threading
import urllib.parse

LISTEN = ("127.0.0.1", 8899)
UPSTREAM_HOST = "hatch-egress-proxy"
UPSTREAM_PORT = 3128


def upstream_auth():
    hp = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY", "")
    u = urllib.parse.urlparse(hp)
    if u.username:
        cred = f"{urllib.parse.unquote(u.username)}:{urllib.parse.unquote(u.password or '')}"
        return "Basic " + base64.b64encode(cred.encode()).decode()
    return None


def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def handle(client):
    srv = None
    try:
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = client.recv(65536)
            if not chunk:
                client.close()
                return
            buf += chunk
            if len(buf) > 1 << 20:
                client.close()
                return
        head, _, rest = buf.partition(b"\r\n\r\n")
        lines = head.decode("latin1").split("\r\n")
        auth = upstream_auth()
        out_lines = [lines[0]]
        for ln in lines[1:]:
            if ln.lower().startswith("proxy-authorization:"):
                continue
            out_lines.append(ln)
        if auth:
            out_lines.append(f"Proxy-Authorization: {auth}")
        out = ("\r\n".join(out_lines) + "\r\n\r\n").encode("latin1") + rest
        srv = socket.create_connection((UPSTREAM_HOST, UPSTREAM_PORT), timeout=30)
        srv.sendall(out)
        t = threading.Thread(target=pipe, args=(srv, client), daemon=True)
        t.start()
        pipe(client, srv)
    except OSError:
        pass
    finally:
        try:
            client.close()
        except OSError:
            pass
        if srv is not None:
            try:
                srv.close()
            except OSError:
                pass


def main():
    ls = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ls.bind(LISTEN)
    ls.listen(100)
    print("relay listening on 127.0.0.1:8899", flush=True)
    while True:
        c, _ = ls.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()


if __name__ == "__main__":
    main()
