'use client';

import { useEffect, useState } from 'react';

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto border border-black/10 bg-black p-4 text-xs leading-relaxed text-white">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-black/10 pt-10">
      <p className="label-caps text-muted-foreground">{label}</p>
      <h2 className="mt-2 font-serif text-3xl font-semibold">{title}</h2>
      <div className="mt-5 space-y-4 text-sm leading-relaxed text-foreground/85">{children}</div>
    </section>
  );
}

function Endpoint({ method, path, desc, auth }: { method: string; path: string; desc: string; auth?: string }) {
  return (
    <div className="flex flex-col gap-1 border border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-14 shrink-0 text-xs font-semibold">{method}</span>
      <code className="shrink-0 text-xs sm:w-64">{path}</code>
      <span className="flex-1 text-xs text-muted-foreground">{desc}</span>
      {auth && <span className="label-caps shrink-0 text-[10px] text-muted-foreground">{auth}</span>}
    </div>
  );
}

export default function DocsPage() {
  const [origin, setOrigin] = useState('https://your-storefront-host');
  useEffect(() => setOrigin(window.location.origin), []);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || origin;

  return (
    <div data-testid="docs-page" className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <p className="label-caps text-muted-foreground">Platform documentation</p>
      <h1 className="mt-3 font-serif text-5xl font-semibold tracking-tight">
        Build on STOREFRONT<span className="text-muted-foreground">.</span>
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
        Three ways in: a REST API for programmatic access, an MCP server so any AI client can talk to the store, and Aria — the on-site AI
        shopping concierge, running on Claude or Groq.
      </p>

      <nav className="mt-8 flex flex-wrap gap-3">
        {[
          ['#api', 'REST API'],
          ['#agent', 'AI Agent'],
          ['#mcp', 'MCP Server'],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="label-caps border border-black/15 px-4 py-2 transition-colors hover:bg-black hover:text-white"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-14 space-y-14">
        <Section id="api" label="01 — REST" title="REST API">
          <p>
            All routes live under <code className="bg-secondary px-1.5 py-0.5 text-xs">{origin}/api/v1</code>. Authentication uses JWT —
            sent as an httpOnly cookie or an <code className="bg-secondary px-1.5 py-0.5 text-xs">Authorization: Bearer</code> header.
            Cookie-authenticated writes also send an <code className="bg-secondary px-1.5 py-0.5 text-xs">X-CSRF-Token</code> header, and
            staff routes require a permission such as <code className="bg-secondary px-1.5 py-0.5 text-xs">orders:manage</code>.
          </p>
          <p>
            The full reference is generated from the server&apos;s own route table and request schemas, so it never drifts from the code:
            every path, parameter, request body and the permission each admin route needs.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={`${apiBase}/api/v1/docs/`}
              target="_blank"
              rel="noreferrer"
              data-testid="docs-api-reference"
              className="label-caps bg-black px-4 py-2 text-white transition-opacity hover:opacity-80"
            >
              Interactive API reference
            </a>
            <a
              href={`${apiBase}/api/v1/openapi.json`}
              target="_blank"
              rel="noreferrer"
              className="label-caps border border-black/15 px-4 py-2 transition-colors hover:bg-black hover:text-white"
            >
              OpenAPI 3.1 spec
            </a>
          </div>
          <p className="label-caps pt-2 text-muted-foreground">Example — search products</p>
          <Code>{`curl "${origin}/api/v1/products?q=jacket&maxPrice=500000&sort=rating"`}</Code>
        </Section>

        <Section id="agent" label="02 — AI" title="AI Agent (Aria)">
          <p>
            Aria is the floating assistant in the bottom-right corner of every store page. She runs on Claude or Groq with server-side tool
            calling against live store data: product search, per-size stock, best prices and bundle offers from the promotion engine, order
            status (scoped to the signed-in customer), cart context, and store policies. Replies stream in as they are generated, and any
            change to your bag or orders waits for you to confirm it. Every conversation is persisted and reviewable by staff under{' '}
            <strong>Admin → Agent chats</strong>.
          </p>
          <p>You can also call the agent directly:</p>
          <Code>{`curl -X POST "${origin}/api/v1/agent/chat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "sess-my-unique-id",
    "message": "Recommend footwear under 3000 rupees"
  }'`}</Code>
          <p className="text-xs text-muted-foreground">
            Pass a stable <code>sessionId</code> to keep multi-turn context. Signed-in requests (cookie/Bearer) unlock order lookups for
            that customer.
          </p>
        </Section>

        <Section id="mcp" label="03 — MCP" title="MCP Server">
          <p>
            The store exposes a <strong>Model Context Protocol</strong> server over Streamable HTTP, so Claude Desktop, Cursor, or any MCP
            client can query the catalog and order status as native tools.
          </p>
          <p className="label-caps pt-1 text-muted-foreground">Endpoint</p>
          <Code>{`${origin}/mcp        (alias of ${origin}/api/v1/mcp)`}</Code>
          <p className="label-caps pt-1 text-muted-foreground">Tools exposed</p>
          <div className="space-y-2">
            <Endpoint method="tool" path="search_products" desc="Search catalog by query, category, price range" />
            <Endpoint method="tool" path="get_product_details" desc="Full product detail incl. per-size stock" />
            <Endpoint method="tool" path="list_categories" desc="Categories with counts" />
            <Endpoint method="tool" path="get_order_status" desc="Order status + timeline (order number + email)" />
            <Endpoint method="tool" path="get_best_price" desc="Price a cart with the promotion engine (lowest combination of offers)" />
            <Endpoint method="tool" path="suggest_bundles" desc="Bundle offers that include a product" />
            <Endpoint method="tool" path="get_store_info" desc="Shipping, returns, payments, offers & promo codes, sizing" />
          </div>
          <p className="label-caps pt-1 text-muted-foreground">Claude Desktop / Cursor config</p>
          <Code>{`{
  "mcpServers": {
    "storefront": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${origin}/mcp"]
    }
  }
}`}</Code>
          <p className="label-caps pt-1 text-muted-foreground">Raw JSON-RPC (no client needed)</p>
          <Code>{`curl -X POST "${origin}/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</Code>
        </Section>
      </div>
    </div>
  );
}
