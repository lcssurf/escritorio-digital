"""A stand-in for Google's OAuth token endpoint and the Google Ads API (tests, and the UI's local preview):
refresh_token "good" works, anything else is invalid_grant; developer token "revoked" is refused by the Ads API.
Run it alone: python tests/fake_google_ads.py [port]."""
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ACCOUNTS = {"1234567890": ("Jestr Ads (manager)", True), "2345678901": ("Jestr Shop", False),
            "3456789012": ("Jestr App installs", False)}
RETIRED = {"v25"}  # answers 404, as a version Google hasn't opened (or has closed) does


class FakeGoogle(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _ads_ok(self):
        if self.headers.get("Authorization") != "Bearer ya29.fake":
            self._send(401, {"error": {"code": 401, "status": "UNAUTHENTICATED", "message": "bad token"}})
            return False
        if self.headers.get("developer-token") == "revoked":
            self._send(403, {"error": {"code": 403, "status": "PERMISSION_DENIED", "details": [{"errors": [
                {"errorCode": {"authorizationError": "DEVELOPER_TOKEN_NOT_APPROVED"},
                 "message": "The developer token is not approved."}]}]}})
            return False
        return True

    def do_GET(self):
        ver = self.path.split("/")[1]
        if ver in RETIRED:
            return self._send(404, {})
        if self.path.endswith("/customers:listAccessibleCustomers") and self._ads_ok():
            self._send(200, {"resourceNames": [f"customers/{c}" for c in ACCOUNTS]})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path.startswith("/token"):
            f = dict(urllib.parse.parse_qsl(body.decode()))
            if f.get("grant_type") == "refresh_token" and f.get("refresh_token") == "good" and f.get("client_id"):
                return self._send(200, {"access_token": "ya29.fake", "expires_in": 3599, "token_type": "Bearer"})
            return self._send(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
        parts = self.path.split("/")
        if parts[1] in RETIRED:
            return self._send(404, {})
        if not self._ads_ok():
            return
        cid = parts[3]
        name, manager = ACCOUNTS.get(cid, ("?", False))
        if self.path.endswith("googleAds:search"):
            return self._send(200, {"results": [{"customer": {"id": cid, "descriptiveName": name, "manager": manager}}]})
        if self.path.endswith("googleAds:searchStream"):
            q = json.loads(body).get("query", "")
            if "customer.currency_code" in q:
                rows = [{"customer": {"descriptiveName": name, "currencyCode": "USD"}}]
            elif "segments.date" in q and "FROM customer" in q:  # per day: 3 days of 10 clicks, $5, 1 conversion
                rows = [{"segments": {"date": f"2026-09-2{i}"}, "metrics": {"costMicros": "5000000", "clicks": "10",
                                                                            "impressions": "400", "conversions": 1.0}}
                        for i in (5, 6, 7)]
            else:  # per campaign (Google splits a campaign's rows by date: two rows for Search)
                m = lambda c, k, cv: {"costMicros": str(c), "clicks": str(k), "impressions": str(k * 40),  # noqa
                                      "conversions": cv}
                rows = [{"campaign": {"id": "11", "name": f"{name} · Search", "status": "ENABLED"},
                         "metrics": m(4500000, 8, 1.0)},
                        {"campaign": {"id": "11", "name": f"{name} · Search", "status": "ENABLED"},
                         "metrics": m(4500000, 8, 1.0)},
                        {"campaign": {"id": "12", "name": f"{name} · Brand", "status": "PAUSED"},
                         "metrics": m(6000000, 14, 1.0)}]
                rows[0]["metrics"].update(impressions="1200", clicks="80", costMicros="45000000")
            return self._send(200, [{"results": rows, "fieldMask": "x", "query": q}])
        self._send(404, {})


def serve(port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), FakeGoogle)
    return srv


if __name__ == "__main__":
    s = serve(int(sys.argv[1]) if len(sys.argv) > 1 else 8798)
    print(f"fake Google on :{s.server_address[1]}: FARM_GOOGLE_OAUTH=http://127.0.0.1:{s.server_address[1]}/token "
          f"FARM_GOOGLE_ADS_API=http://127.0.0.1:{s.server_address[1]}", flush=True)
    s.serve_forever()
