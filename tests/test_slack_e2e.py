"""End to end: a real farm (fake `claude`) and the Slack bridge against a stand-in Slack. It serves the Web API and a
Socket Mode WebSocket over TLS (a throwaway self-signed certificate), so the WebSocket client, the envelope acks,
connecting, a mention becoming a sub-agent and its answer landing in the thread are all the real code paths."""
import base64
import hashlib
import json
import os
import shutil
import ssl
import struct
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

import pytest

from test_farm import start_farm, stop_farm, wait_for

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MEMBER = {"id": "U1", "name": "gil", "team_id": "T1", "real_name": "Gil", "profile": {"email": "gil@jestr.ai"}}


def _frame(text: str) -> bytes:  # server to client: unmasked
    data = text.encode()
    n = len(data)
    return bytes([0x81]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack("!H", n)) + data


def _read_frame(sock) -> tuple[int, bytes]:  # client to server: masked
    def read(n):
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError
            buf += chunk
        return buf
    b1, b2 = read(2)
    n = b2 & 0x7F
    n = struct.unpack("!H", read(2))[0] if n == 126 else struct.unpack("!Q", read(8))[0] if n == 127 else n
    mask = read(4)
    return b1 & 0x0F, bytes(b ^ mask[i % 4] for i, b in enumerate(read(n)))


class FakeSlack:
    def __init__(self, tmp):
        self.calls, self.acks, self.events = [], [], []
        cert, key = str(tmp / "cert.pem"), str(tmp / "key.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
                        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert],
                       check=True, capture_output=True)
        self.cert = cert
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                method = self.path.rsplit("/", 1)[-1]
                p = {k: v[-1] for k, v in parse_qs(self.rfile.read(int(self.headers["Content-Length"] or 0)).decode()).items()}
                fake.calls.append((method, p, self.headers.get("Authorization")))
                out = {"ok": True}
                if method == "auth.test":
                    out.update(team="jestr", team_id="T1", user="clodfarm-test", user_id="UBOT", bot_id="B1",
                               url="https://jestr.slack.com/")
                elif method == "apps.connections.open":
                    out["url"] = f"wss://localhost:{fake.port}/link/?ticket=1"
                elif method == "users.info":
                    out["user"] = MEMBER
                elif method == "chat.postMessage":
                    out["ts"] = str(time.time())
                body = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):  # the Socket Mode WebSocket
                accept = base64.b64encode(hashlib.sha1((self.headers["Sec-WebSocket-Key"] + GUID).encode()).digest()).decode()
                self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                                  f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
                self.wfile.flush()
                sock = self.connection
                sock.sendall(_frame(json.dumps({"type": "hello", "num_connections": 1, "connection_info": {"app_id": "A1"}})))
                sent = 0
                sock.settimeout(0.2)
                while not fake.stopped:
                    while sent < len(fake.events):
                        sock.sendall(_frame(json.dumps(fake.events[sent])))
                        sent += 1
                    try:
                        op, data = _read_frame(sock)
                    except (TimeoutError, ssl.SSLError, OSError):
                        continue
                    if op == 8:
                        return
                    if op == 1:
                        fake.acks.append(json.loads(data)["envelope_id"])

        self.stopped = False
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        self.srv.socket = ctx.wrap_socket(self.srv.socket, server_side=True)
        self.srv.daemon_threads = True
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def mention(self, text, ts):
        self.events.append({"type": "events_api", "envelope_id": f"env-{ts}", "accepts_response_payload": False,
                            "payload": {"team_id": "T1", "event": {"type": "app_mention", "user": "U1", "channel": "C1",
                                                                   "ts": ts, "text": f"<@UBOT> {text}"}}})

    def posts(self):
        return [p for m, p, _ in self.calls if m == "chat.postMessage"]

    def stop(self):
        self.stopped = True
        self.srv.shutdown()


@pytest.mark.skipif(not shutil.which("openssl"), reason="needs openssl for the stand-in Slack's certificate")
def test_a_slack_mention_becomes_a_sub_agent_and_its_answer_lands_in_the_thread(env, backend, tmp_path, monkeypatch):
    if backend != "sqlite":
        pytest.skip("the store paths are covered on both backends elsewhere")
    slack_srv = FakeSlack(tmp_path)
    monkeypatch.setenv("SSL_CERT_FILE", slack_srv.cert)  # trust the throwaway certificate
    from clodfarm import slack
    monkeypatch.setattr(slack, "API_URL", f"https://localhost:{slack_srv.port}/api")
    farm, t = start_farm()
    bridge = slack.SlackBridge(farm.cfg, farm.store)
    try:
        v = bridge.connect("xoxb-test", "xapp-test", [], "https://clod.farm/test/")  # what the UI's CONNECT does
        assert v["team"] == "jestr" and v["bot"] == "clodfarm-test"
        assert ("auth.test", {}, "Bearer xoxb-test") in slack_srv.calls
        wait_for(lambda: bridge.state == "live", timeout=15)
        assert bridge.view()["dm_url"] == "https://slack.com/app_redirect?app=A1&team=T1"  # app id from the hello

        slack_srv.mention("COMMIT fromslack", "100.1")
        wait_for(lambda: "env-100.1" in slack_srv.acks, timeout=10)
        on_it = wait_for(lambda: [p for p in slack_srv.posts() if "On it" in p["text"]], timeout=15)[0]
        assert on_it["thread_ts"] == "100.1" and "Watch it on the farm" in on_it["text"]
        answer = wait_for(lambda: [p for p in slack_srv.posts() if p["text"].startswith("committed fromslack")], timeout=60)[0]
        assert answer["channel"] == "C1" and answer["thread_ts"] == "100.1"
        print("\n--- the thread as Slack would show it ---\n" + "\n".join(f"[farm] {p['text']}" for p in slack_srv.posts()))
        wait_for(lambda: any(m == "reactions.add" and p.get("name") == "white_check_mark" for m, p, _ in slack_srv.calls))
        assert os.path.exists(env / "workspace" / "repo" / "fromslack.txt")  # the sub-agent's work landed on main

        slack_srv.events.append(slack_srv.events[-1])  # Slack retries the same event: nothing new starts
        time.sleep(2)
        assert len([p for p in slack_srv.posts() if "On it" in p["text"]]) == 1
    finally:
        bridge.stop()
        stop_farm(farm, t)
        slack_srv.stop()
