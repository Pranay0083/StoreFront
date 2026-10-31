'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto bg-primary p-5 text-sm leading-relaxed text-primary-foreground">
      <code>{children}</code>
    </pre>
  );
}

const inline = 'bg-secondary px-1.5 py-0.5 font-mono text-[0.9em]';

/** Rows for long copy: the heading on the left third, the text and code in the other two. */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid scroll-mt-24 grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
      <h2 id={`${id}-heading`} className="text-display-md font-extrabold lg:col-span-4">
        {title}
      </h2>
      <div className="min-w-0 space-y-5 text-lg leading-relaxed lg:col-span-8 [&>p]:max-w-[64ch]">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-3 text-base font-semibold">{children}</h3>;
}

const TOOLS: [string, string][] = [
  ['search_products', 'Search the catalogue by query, category and price range'],
  ['get_product_details', 'Full product detail, including stock per size'],
  ['list_categories', 'Departments with their counts'],
  ['get_order_status', 'Order status and timeline, by order number and email'],
  ['get_best_price', 'Price a cart with the promotion engine: the lowest combination of offers'],
  ['suggest_bundles', 'Bundle offers that include a product'],
  ['get_store_info', 'Shipping, returns, payments, offers, promo codes and sizing'],
];

export default function DocsPage() {
  const [origin, setOrigin] = useState('https://your-storefront-host');
  useEffect(() => setOrigin(window.location.origin), []);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || origin;

  return (
    <div data-testid="docs-page" className="mx-auto max-w-[1760px] px-4 pb-8 pt-10 sm:px-8 sm:pt-16">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-8">
        <h1 className="animate-rise text-balance text-display-lg font-extrabold lg:col-span-7">Build on STOREFRONT</h1>
        <div className="animate-rise [animation-delay:80ms] lg:col-span-5">
          <p className="max-w-[46ch] text-lg">
            Three ways in: a REST API for programs, an MCP server so any AI client can use the store as tools, and Aria, the shopping
            assistant on every page, running on Claude or Groq.
          </p>
          <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-base font-semibold">
            {[
              ['#api', 'REST API'],
              ['#agent', 'AI agent'],
              ['#mcp', 'MCP server'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="underline underline-offset-4">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <div className="mt-24 space-y-24 sm:mt-32 sm:space-y-32">
        <Section id="api" title="REST API">
          <p>
            All routes live under <code className={inline}>{origin}/api/v1</code>. Authentication uses JWT, sent as an httpOnly cookie or an{' '}
            <code className={inline}>Authorization: Bearer</code> header. Cookie-authenticated writes also send an{' '}
            <code className={inline}>X-CSRF-Token</code> header, and staff routes need a permission such as{' '}
            <code className={inline}>orders:manage</code>.
          </p>
          <p>
            The full reference is generated from the server&apos;s own route table and request schemas, so it never drifts from the code:
            every path, parameter, request body and the permission each admin route needs.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-1">
            <Button asChild size="lg">
              <a href={`${apiBase}/api/v1/docs/`} target="_blank" rel="noreferrer" data-testid="docs-api-reference">
                Interactive API reference
              </a>
            </Button>
            <a
              href={`${apiBase}/api/v1/openapi.json`}
              target="_blank"
              rel="noreferrer"
              className="text-base font-semibold underline underline-offset-4"
            >
              OpenAPI 3.1 spec
            </a>
          </div>
          <Label>Search products</Label>
          <Code>{`curl "${origin}/api/v1/products?q=jacket&maxPrice=500000&sort=rating"`}</Code>
        </Section>

        <Section id="agent" title="AI agent">
          <p>
            Aria is the assistant in the bottom-right corner of every store page. She runs on Claude or Groq with server-side tool calls
            against live store data: product search, stock per size, best prices and bundle offers from the promotion engine, order status
            (scoped to the signed-in customer), the bag, and store policies. Replies stream in as they are written, and any change to your
            bag or orders waits for you to confirm it. Every conversation is kept and reviewable by staff under{' '}
            <strong>Admin, Agent chats</strong>.
          </p>
          <Label>Call the agent directly</Label>
          <Code>{`curl -X POST "${origin}/api/v1/agent/chat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "sess-my-unique-id",
    "message": "Recommend footwear under 3000 rupees"
  }'`}</Code>
          <p className="text-base text-muted-foreground">
            Pass a stable <code className={inline}>sessionId</code> to keep multi-turn context. Signed-in requests (cookie or Bearer) unlock
            order lookups for that customer.
          </p>
        </Section>

        <Section id="mcp" title="MCP server">
          <p>
            The store exposes a <strong>Model Context Protocol</strong> server over Streamable HTTP, so Claude Desktop, Cursor or any MCP
            client can query the catalogue and order status as native tools.
          </p>
          <Label>Endpoint</Label>
          <Code>{`${origin}/mcp        (alias of ${origin}/api/v1/mcp)`}</Code>
          <Label>Tools</Label>
          <Table>
            <TableHeader className="bg-background">
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>What it does</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TOOLS.map(([name, desc]) => (
                <TableRow key={name}>
                  <TableCell className="whitespace-nowrap font-mono text-sm">{name}</TableCell>
                  <TableCell className="text-base">{desc}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Label>Claude Desktop or Cursor configuration</Label>
          <Code>{`{
  "mcpServers": {
    "storefront": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${origin}/mcp"]
    }
  }
}`}</Code>
          <Label>Raw JSON-RPC, no client needed</Label>
          <Code>{`curl -X POST "${origin}/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</Code>
        </Section>
      </div>
    </div>
  );
}
