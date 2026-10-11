#!/usr/bin/env python3
"""Shared E2E harness for Trigon.

The suites in this directory drive headless Chromium against a local
`http.server` serving site/ (or against the deployed site for *_live.py).
This module holds every environment-coupled decision so the suites stay
portable: on a normal machine they use direct egress and Playwright's
bundled Chromium with zero configuration; in the sandboxed agent VM they
go through relay.py (which injects Proxy-Authorization for the egress
MITM proxy that Chromium can't handshake with itself).

Environment variables (all optional):
  E2E_SITE_DIR     directory served as the app under test (default: <repo>/site)
  E2E_LIVE_URL     deployed URL for the *_live.py scripts
                   (default: https://trigon.pages.dev)
  E2E_CHROME_PATH  Chromium executable (default: Playwright's bundled Chromium)
  E2E_RELAY        set to 1 to spawn relay.py and proxy egress through it
                   (default: 0 — direct egress)
  E2E_PROXY        proxy server URL when the relay is on
                   (default: http://127.0.0.1:8899)
  E2E_PROXY_BYPASS proxy bypass list (default: 127.0.0.1,localhost)
  E2E_CHROME_ARGS  extra Chromium args, space-separated (default: "")
  E2E_NO_SANDBOX   set to 1 to add --no-sandbox
                   (default: auto-added when running as root)

The agent VM's idiosyncratic setup is therefore exactly:
  E2E_RELAY=1 \\
  E2E_CHROME_PATH=$HOME/workspace/.browsers/chrome-linux64/chrome \\
  E2E_CHROME_ARGS="--disable-dev-shm-usage"

When E2E_RELAY=1, harness.launch() starts relay.py on demand if nothing is
already listening on the proxy port, so no suite depends on a pre-running
relay; the relay is reaped at process exit.
"""

import atexit
import functools
import http.server
import os
import shlex
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

E2E_ROOT = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(E2E_ROOT)

DEFAULT_LIVE_URL = "https://trigon.pages.dev"


def _flag(name, default="0"):
    return os.environ.get(name, default).strip().lower() not in ("", "0", "false", "no")


def site_dir():
    """Directory served as the app under test."""
    return os.environ.get("E2E_SITE_DIR", os.path.join(REPO_ROOT, "site"))


def live_url():
    """Deployed URL for the *_live.py scripts."""
    return os.environ.get("E2E_LIVE_URL", DEFAULT_LIVE_URL)


def use_relay():
    return _flag("E2E_RELAY")


def _relay_script():
    return os.path.join(E2E_ROOT, "relay.py")


_relay_proc = None


def start_relay():
    """Spawn relay.py for proxied egress; no-op returning None when E2E_RELAY is unset."""
    global _relay_proc
    if not use_relay():
        return None
    if _relay_proc is not None and _relay_proc.poll() is None:
        return _relay_proc
    _relay_proc = subprocess.Popen(
        [sys.executable, _relay_script()],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={**os.environ},
    )
    time.sleep(2)  # let the listener come up
    return _relay_proc


def stop_relay(proc=None):
    """Terminate the relay; safe to call with None (relay disabled)."""
    proc = proc if proc is not None else _relay_proc
    if proc is not None and proc.poll() is None:
        proc.terminate()


atexit.register(stop_relay)


def chrome_args(extra=()):
    """Chromium CLI args derived from the environment."""
    args = list(shlex.split(os.environ.get("E2E_CHROME_ARGS", "")))
    if _flag("E2E_NO_SANDBOX", "1" if os.geteuid() == 0 else "0"):
        if "--no-sandbox" not in args:
            args.append("--no-sandbox")
    if use_relay() and "--ignore-certificate-errors" not in args:
        # egress goes through the MITM proxy
        args.append("--ignore-certificate-errors")
    args.extend(extra)
    return args


def launch_kwargs():
    """Keyword args for playwright's p.chromium.launch()."""
    kw = {"args": chrome_args()}
    chrome = os.environ.get("E2E_CHROME_PATH", "").strip()
    if chrome:
        kw["executable_path"] = chrome
    if use_relay():
        kw["proxy"] = {
            "server": os.environ.get("E2E_PROXY", "http://127.0.0.1:8899"),
            "bypass": os.environ.get("E2E_PROXY_BYPASS", "127.0.0.1,localhost"),
        }
    return kw


def _port_open(host, port):
    s = socket.socket()
    s.settimeout(1)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def launch(p, **overrides):
    """Launch Chromium the way this environment needs.

    When E2E_RELAY=1 the relay is started on demand if nothing is already
    listening on the proxy port, so suites don't depend on a pre-running
    relay (explicit harness.start_relay() calls remain fine).
    """
    if use_relay():
        u = urllib.parse.urlparse(os.environ.get("E2E_PROXY", "http://127.0.0.1:8899"))
        if not _port_open(u.hostname or "127.0.0.1", u.port or 8899):
            start_relay()
    kw = launch_kwargs()
    kw.update(overrides)
    return p.chromium.launch(**kw)


def serve(port, directory=None):
    """Serve `directory` on 127.0.0.1:port in a daemon thread; returns the server."""
    directory = directory or site_dir()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def ensure_drawer(pg):
    """Open the input drawer if closed — drawer contents (date inputs,
    manual location, skip controls) aren't actionable otherwise."""
    if pg.locator("#input-card.open").count() == 0:
        pg.locator("#input-fab").click(timeout=8000)
        pg.wait_for_selector("#input-card.open", timeout=8000)
