"""Backend integration tests for StoreFront + AI Agent + MCP + Admin chats."""
import os
import time
import uuid
import json
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("NEXT_PUBLIC_API_URL")
    or frontend_env.get("NEXT_PUBLIC_API_URL")
    or frontend_env.get("REACT_APP_BACKEND_URL")
)
assert BASE_URL, "Missing backend URL in env"
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@storefront.dev"
ADMIN_PASS = "Admin@123"
CUST_EMAIL = "customer@storefront.dev"
CUST_PASS = "Customer@123"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(sess, email, password):
    r = sess.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    token = data.get("token") or data.get("accessToken") or data.get("jwt")
    return token, data


@pytest.fixture(scope="session")
def admin_token(s):
    tok, _ = _login(requests.Session(), ADMIN_EMAIL, ADMIN_PASS)
    return tok


@pytest.fixture(scope="session")
def customer_token(s):
    tok, _ = _login(requests.Session(), CUST_EMAIL, CUST_PASS)
    return tok


# ---------- health ----------
def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "ok"


# ---------- auth ----------
def test_admin_login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "user" in body or "email" in body or "token" in body


def test_customer_login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": CUST_EMAIL, "password": CUST_PASS}, timeout=30)
    assert r.status_code == 200, r.text[:300]


# ---------- agent chat ----------
QA_SESSION = f"sess-qa-{uuid.uuid4().hex[:8]}"


def test_agent_chat_product_search():
    payload = {"sessionId": QA_SESSION, "message": "What footwear do you have under 5000?"}
    r = requests.post(f"{BASE_URL}/api/agent/chat", json=payload, timeout=60)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    body = r.json()
    reply = (body.get("reply") or body.get("message") or json.dumps(body)).lower()
    # Should reference some product / footwear language
    assert any(k in reply for k in ["shoe", "footwear", "canvas", "sneaker", "boot", "high-top", "loafer", "sandal", "trainer"]), reply[:500]


def test_agent_chat_multiturn_context():
    # follow up on same session
    payload = {"sessionId": QA_SESSION, "message": "What sizes does the first one have?"}
    r = requests.post(f"{BASE_URL}/api/agent/chat", json=payload, timeout=60)
    assert r.status_code == 200, r.text[:400]
    body = r.json()
    reply = (body.get("reply") or body.get("message") or "").lower()
    assert len(reply) > 0
    # loose: mentions size or numeric size
    assert ("size" in reply) or re.search(r"\b(6|7|8|9|10|11|12|s|m|l|xl)\b", reply), reply[:500]


def test_agent_history():
    r = requests.get(f"{BASE_URL}/api/agent/history", params={"sessionId": QA_SESSION}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    msgs = body.get("messages") or body.get("history") or body
    assert isinstance(msgs, list)
    roles = [m.get("role") for m in msgs if isinstance(m, dict)]
    assert "user" in roles and "assistant" in roles, roles


def test_agent_shipping_faq():
    sid = f"sess-qa-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{BASE_URL}/api/agent/chat", json={"sessionId": sid, "message": "What is your shipping policy?"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    reply = (r.json().get("reply") or "").lower()
    assert ("2,999" in reply) or ("2999" in reply) or ("free shipping" in reply) or ("₹99" in reply) or ("shipping" in reply), reply[:500]


def test_agent_authenticated_orders(customer_token):
    sid = f"sess-qa-{uuid.uuid4().hex[:8]}"
    headers = {"Authorization": f"Bearer {customer_token}"} if customer_token else {}
    # retry once on 502 (rate limit) per playbook note
    r = requests.post(f"{BASE_URL}/api/agent/chat", json={"sessionId": sid, "message": "Track my latest order"}, headers=headers, timeout=60)
    if r.status_code == 502:
        time.sleep(5)
        r = requests.post(f"{BASE_URL}/api/agent/chat", json={"sessionId": sid, "message": "Track my latest order"}, headers=headers, timeout=60)
    assert r.status_code == 200, r.text[:400]
    reply = (r.json().get("reply") or "").lower()
    # either has orders or gracefully says no orders / sign in
    assert any(k in reply for k in ["order", "no orders", "haven't", "haven’t", "don't have", "sign in", "log in"]), reply[:500]


# ---------- MCP ----------
MCP_HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}


def _parse_mcp(resp):
    # supports both plain json and SSE 'data: {...}' framing
    ct = resp.headers.get("content-type", "")
    text = resp.text
    if "application/json" in ct:
        return resp.json()
    # SSE
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    return json.loads(text)


def test_mcp_initialize():
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "qa", "version": "1.0"}}}
    r = requests.post(f"{BASE_URL}/api/mcp", json=body, headers=MCP_HEADERS, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    j = _parse_mcp(r)
    assert "result" in j, j
    assert "protocolVersion" in j["result"]


def test_mcp_tools_list():
    body = {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
    r = requests.post(f"{BASE_URL}/api/mcp", json=body, headers=MCP_HEADERS, timeout=30)
    assert r.status_code == 200, r.text[:400]
    j = _parse_mcp(r)
    tools = j["result"]["tools"]
    assert isinstance(tools, list) and len(tools) >= 5, f"tools count={len(tools)}"


def test_mcp_tools_call_search_products():
    body = {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "search_products", "arguments": {"category": "Footwear"}}}
    r = requests.post(f"{BASE_URL}/api/mcp", json=body, headers=MCP_HEADERS, timeout=30)
    assert r.status_code == 200, r.text[:400]
    j = _parse_mcp(r)
    result = j.get("result", {})
    content = result.get("content") or []
    txt = json.dumps(result).lower()
    assert "product" in txt or "footwear" in txt or content, result


def test_mcp_alias_via_next_rewrite():
    body = {"jsonrpc": "2.0", "id": 4, "method": "tools/list"}
    r = requests.post(f"{BASE_URL}/mcp", json=body, headers=MCP_HEADERS, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    j = _parse_mcp(r)
    assert "result" in j and "tools" in j["result"]


# ---------- admin conversations ----------
def test_admin_conversations_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/conversations", timeout=30)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_admin_conversations_lists_qa_sessions(admin_token):
    assert admin_token, "no admin token"
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/api/admin/conversations", headers=headers, timeout=60)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    body = r.json()
    convs = body if isinstance(body, list) else (body.get("conversations") or body.get("data") or [])
    assert isinstance(convs, list) and len(convs) > 0, f"no conversations returned: {str(body)[:400]}"
    # find our QA session
    found = next((c for c in convs if c.get("sessionId") == QA_SESSION or c.get("session_id") == QA_SESSION), None)
    assert found is not None, f"QA session {QA_SESSION} not found in conversations"
    msgs = found.get("messages") or []
    roles = {m.get("role") for m in msgs if isinstance(m, dict)}
    assert "user" in roles and "assistant" in roles, f"roles={roles}"


# ---------- regression: products ----------
def test_products_listing():
    r = requests.get(f"{BASE_URL}/api/products", timeout=30)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    products = body if isinstance(body, list) else (body.get("items") or body.get("products") or body.get("data") or [])
    assert len(products) >= 1, f"body keys={list(body.keys()) if isinstance(body, dict) else 'list'}"
