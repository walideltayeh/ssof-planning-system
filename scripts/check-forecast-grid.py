"""Browser regression check using isolated API fixtures; never writes live data.

Start bundled Chromium with --headless=new --no-sandbox
--remote-debugging-port=9222 --user-data-dir=/tmp/forecast-grid-browser,
then run python scripts/check-forecast-grid.py.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import time
import urllib.request
from urllib.parse import urlparse


class Browser:
    def __init__(self):
        tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
        url = urlparse(next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page"))
        self.sock = socket.create_connection((url.hostname, url.port))
        self.sock.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            f"GET {url.path} HTTP/1.1\r\nHost: {url.netloc}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        header = b""
        while not header.endswith(b"\r\n\r\n"):
            header += self.sock.recv(1)
        assert b" 101 " in header.split(b"\r\n", 1)[0], header.decode()
        accept = base64.b64encode(hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()
        ).digest())
        assert accept in header
        self.sequence = 0
        self.pending = {}

    def read(self, count):
        data = b""
        while len(data) < count:
            data += self.sock.recv(count - len(data))
        return data

    def receive(self):
        first, second = self.read(2)
        size = second & 127
        if size == 126:
            size = struct.unpack("!H", self.read(2))[0]
        elif size == 127:
            size = struct.unpack("!Q", self.read(8))[0]
        assert first & 15 == 1, "Expected text CDP frame"
        return json.loads(self.read(size))

    def send(self, method, params=None):
        self.sequence += 1
        data = json.dumps({"id": self.sequence, "method": method, "params": params or {}}).encode()
        mask = os.urandom(4)
        header = bytes([129, 128 | len(data)]) if len(data) < 126 else (
            bytes([129, 254]) + struct.pack("!H", len(data)) if len(data) <= 65535
            else bytes([129, 255]) + struct.pack("!Q", len(data)))
        self.sock.sendall(header + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(data)))
        return self.sequence

    def call(self, method, params=None):
        target = self.send(method, params)
        while target not in self.pending:
            message = self.receive()
            if "id" in message:
                self.pending[message["id"]] = message
            elif message.get("method") == "Fetch.requestPaused":
                self.fulfill(message["params"])
        message = self.pending.pop(target)
        assert "error" not in message, message
        return message.get("result", {})

    def js(self, expression):
        result = self.call("Runtime.evaluate", {
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        })
        assert "exceptionDetails" not in result, result
        return result["result"].get("value")

    def fulfill(self, request):
        url = urlparse(request["request"]["url"])
        methods = url.path.split("/api/trpc/")[-1].split(",")
        data = {
            "country.data": DATA, "data.forecast": {**DATA, "data": FORECAST},
            "focPlanning.list": {"cells": FOC, "receipts": {"entries": [], "warnings": []}},
            "auth.me": None, "presence.heartbeat": {"success": True},
            "presence.leave": {"success": True},
        }
        body = [{"result": {"data": {"json": data.get(method, [])}}} for method in methods]
        payload = body if "batch=1" in url.query else body[0]
        self.send("Fetch.fulfillRequest", {
            "requestId": request["requestId"], "responseCode": 200,
            "responseHeaders": [{"name": "Content-Type", "value": "application/json"}],
            "body": base64.b64encode(json.dumps(payload).encode()).decode(),
        })


SKUS = [{
    "id": i, "name": f"Stress SKU {i:02d} with a deliberately long product description",
    "weight": "50g", "packagingType": "New", "category": "Core",
    "isActive": True, "country": "Syria",
} for i in range(1, 33)]
PERIODS = [{
    "id": i, "month": (i - 1) % 12 + 1, "year": 2026 + (i - 1) // 12,
    "sortOrder": i, "label": f"Month{i:02d} {2026 + (i - 1) // 12}", "country": "Syria",
} for i in range(1, 25)]
FORECAST = [{"skuId": s["id"], "periodId": p["id"], "value": "9876543.21"}
            for s in SKUS for p in PERIODS]
FOC = [{"skuId": s["id"], "periodId": p["id"], "value": "12345.67", "received": False}
       for s in SKUS for p in PERIODS if s["id"] % 2]
DATA = {"skus": SKUS, "periods": PERIODS, "forecast": FORECAST,
        "ims": [], "shipment": [], "actualProduction": [], "arrival": []}

browser = Browser()
browser.call("Page.enable")
browser.call("Runtime.enable")
browser.call("Fetch.enable", {"patterns": [{"urlPattern": "*/api/*"}]})
browser.call("Emulation.setDeviceMetricsOverride", {
    "width": 1024, "height": 768, "deviceScaleFactor": 1, "mobile": False,
})
session = {"user": {
    "id": 999001, "username": "browser-fixture", "displayName": "Browser fixture",
    "role": "admin", "countries": ["Syria"], "isOwner": False,
}, "country": "Syria"}
browser.call("Page.addScriptToEvaluateOnNewDocument", {"source":
    f"localStorage.setItem('ssof-session-v2', {json.dumps(json.dumps(session))});"
    "localStorage.setItem('ssof-unit','MC');"
})
origin = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
browser.call("Page.navigate", {"url": origin + "/forecast"})

for unit in ["MC", "KG", "Tons"]:
    if unit != "MC":
        browser.call("Page.addScriptToEvaluateOnNewDocument", {
            "source": f"localStorage.setItem('ssof-unit','{unit}');",
        })
        browser.call("Page.reload")
        time.sleep(1)
    for attempt in range(60):
        if browser.js("!!document.querySelector('tfoot') && document.querySelectorAll('tbody tr[aria-label]').length >= 32"):
            break
        time.sleep(.25)
    else:
        raise AssertionError(browser.js("document.body.innerText.slice(0,2000)"))
    assert browser.js("localStorage.getItem('ssof-unit')") == unit
    browser.js("document.querySelector('tfoot').closest('table').parentElement.scrollIntoView({block:'start'})")
    for horizontal in [0, 1]:
        for vertical in [0, .5, 1]:
            metrics = browser.js("""(async () => {
                const table = document.querySelector('tfoot').closest('table');
                const scroller = table.parentElement;
                scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) * H;
                scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * V;
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const box = scroller.getBoundingClientRect();
                const rows = [...table.querySelectorAll('tbody tr')].filter(r => r.cells.length > 2);
                const row = rows.find(r => r.getBoundingClientRect().top > box.top + 85 &&
                    r.getBoundingClientRect().bottom < box.bottom - 85) || rows[0];
                const sku = row.cells[1], skuBox = sku.getBoundingClientRect();
                const footer = table.querySelector('tfoot tr'), footerBox = footer.getBoundingClientRect();
                const header = table.querySelector('thead tr'), headerBox = header.getBoundingClientRect();
                const secondHeaderBox = table.querySelectorAll('thead tr')[1].getBoundingClientRect();
                const primary = [...footer.querySelectorAll('td span[title]')];
                const numberSpans = [...table.querySelectorAll('[aria-label="Selected-basis forecast total"] > span')];
                const corner = table.querySelector('thead th:nth-child(2)');
                const cornerStyle = getComputedStyle(corner);
                const clipped = primary.filter(n => n.scrollWidth > n.clientWidth + 1);
                return {
                    scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
                    panelOffset: skuBox.left - box.left,
                    panelBg: getComputedStyle(sku).backgroundColor,
                    panelOpacity: getComputedStyle(sku).opacity,
                    footerBottom: box.bottom - footerBox.bottom,
                    headerTop: headerBox.top - box.top,
                    headerGap: secondHeaderBox.top - headerBox.bottom,
                    footerFont: Math.max(...primary.map(n => parseFloat(getComputedStyle(n).fontSize))),
                    safeClipping: clipped.every(n => getComputedStyle(n).overflow === 'hidden' &&
                        getComputedStyle(n).textOverflow === 'ellipsis' && n.title.length > 0),
                    containedNumbers: numberSpans.every(n => {
                        const cell = n.closest('td').getBoundingClientRect(), rect = n.getBoundingClientRect();
                        return rect.left >= cell.left - 1 && rect.right <= cell.right + 1;
                    }),
                    cornerOpaque: cornerStyle.backgroundColor.startsWith('rgb('),
                    cornerAbovePanel: Number(cornerStyle.zIndex) > Number(getComputedStyle(sku).zIndex),
                    footerHeight: footerBox.height,
                    missingText: /Not set|0 entered|Combined\\s+\\d/.test(table.innerText),
                };
            })()""".replace("* H", f"* {horizontal}").replace("* V", f"* {vertical}"))
            assert metrics["scrollWidth"] > metrics["clientWidth"], metrics
            assert abs(metrics["panelOffset"] - 76) <= 2, metrics
            assert metrics["panelBg"] != "rgba(0, 0, 0, 0)", metrics
            assert not metrics["panelBg"].startswith("rgba("), metrics
            assert metrics["panelOpacity"] == "1", metrics
            assert abs(metrics["headerTop"]) <= 2, metrics
            assert abs(metrics["headerGap"]) <= 2, metrics
            assert 0 <= metrics["footerBottom"] <= 20, metrics
            assert metrics["footerFont"] >= 22, metrics
            assert metrics["safeClipping"] and not metrics["missingText"], metrics
            assert metrics["containedNumbers"], metrics
            assert metrics["cornerOpaque"] and metrics["cornerAbovePanel"], metrics
            assert metrics["footerHeight"] >= 80, metrics
    snapshot = browser.call("Page.captureScreenshot", {"format": "png"})
    with open(f"/tmp/forecast-grid-{unit}.png", "wb") as output:
        output.write(base64.b64decode(snapshot["data"]))
    print(f"{unit}: 1024px, 32 SKUs, 24 months; horizontal extremes and 3 vertical positions passed.")
print("Browser fixtures only; no live data read or written.")
