import asyncio
import os
import signal
import subprocess

import httpx

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NODE_PORT = int(os.environ.get("NODE_PORT", "4001"))
NODE_URL = f"http://127.0.0.1:{NODE_PORT}"

node_proc = None
client: httpx.AsyncClient = None

STRIP_RESP = {b"connection", b"keep-alive", b"transfer-encoding", b"content-length", b"content-encoding", b"upgrade"}


def start_node():
    global node_proc
    subprocess.run(["bash", "-c", f"fuser -k {NODE_PORT}/tcp 2>/dev/null || true"])
    env = {**os.environ, "PORT": str(NODE_PORT), "HOST": "127.0.0.1"}
    node_proc = subprocess.Popen(
        ["node_modules/.bin/tsx", "watch", "--clear-screen=false", "src/index.ts"],
        cwd=BASE_DIR, env=env, start_new_session=True,
    )


def stop_node():
    global node_proc
    if node_proc and node_proc.poll() is None:
        try:
            os.killpg(os.getpgid(node_proc.pid), signal.SIGTERM)
        except Exception:
            pass
    node_proc = None


async def proxy(scope, receive, send):
    body = b""
    while True:
        message = await receive()
        if message["type"] == "http.request":
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        elif message["type"] == "http.disconnect":
            return

    path = scope["path"]
    if scope.get("query_string"):
        path += "?" + scope["query_string"].decode()
    headers = [(k.decode(), v.decode()) for k, v in scope["headers"] if k.lower() != b"host"]

    last_err = None
    for attempt in range(60):
        try:
            req = client.build_request(scope["method"], path, headers=headers, content=body)
            resp = await client.send(req, stream=True)
            break
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            last_err = e
            await asyncio.sleep(0.5)
    else:
        await send({"type": "http.response.start", "status": 503,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body",
                    "body": b'{"error":"backend service starting, retry shortly"}'})
        return

    resp_headers = [(k.encode(), v.encode()) for k, v in resp.headers.items()
                    if k.lower().encode() not in STRIP_RESP]
    await send({"type": "http.response.start", "status": resp.status_code, "headers": resp_headers})
    try:
        async for chunk in resp.aiter_bytes():
            await send({"type": "http.response.body", "body": chunk, "more_body": True})
    finally:
        await resp.aclose()
    await send({"type": "http.response.body", "body": b"", "more_body": False})


async def app(scope, receive, send):
    global client
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                client = httpx.AsyncClient(base_url=NODE_URL, timeout=httpx.Timeout(300.0, connect=5.0))
                start_node()
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                stop_node()
                if client:
                    await client.aclose()
                await send({"type": "lifespan.shutdown.complete"})
                return
    elif scope["type"] == "http":
        await proxy(scope, receive, send)
