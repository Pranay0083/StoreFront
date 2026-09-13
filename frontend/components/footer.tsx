import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-black/10 bg-white">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="font-serif text-4xl font-semibold tracking-tight">STOREFRONT.</p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Considered clothing, shipped with an explicit order state machine.
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="label-caps mb-5 text-muted-foreground">Shop</p>
            <ul className="space-y-3 text-sm">
              <li><Link href="/products?category=Men" className="hover:underline">Men</Link></li>
              <li><Link href="/products?category=Women" className="hover:underline">Women</Link></li>
              <li><Link href="/products?category=Footwear" className="hover:underline">Footwear</Link></li>
              <li><Link href="/products?category=Accessories" className="hover:underline">Accessories</Link></li>
            </ul>
          </div>
          <div className="md:col-span-2">
            <p className="label-caps mb-5 text-muted-foreground">Account</p>
            <ul className="space-y-3 text-sm">
              <li><Link href="/orders" className="hover:underline">Order tracking</Link></li>
              <li><Link href="/login" className="hover:underline">Sign in</Link></li>
              <li><Link href="/register" className="hover:underline">Create account</Link></li>
            </ul>
          </div>
          <div className="md:col-span-3">
            <p className="label-caps mb-5 text-muted-foreground">Platform</p>
            <ul className="space-y-3 text-sm">
              <li><Link href="/docs" data-testid="footer-docs-link" className="hover:underline">Documentation</Link></li>
              <li><Link href="/docs#api" className="hover:underline">REST API</Link></li>
              <li><Link href="/docs#mcp" className="hover:underline">MCP server</Link></li>
              <li><Link href="/docs#agent" className="hover:underline">AI agent</Link></li>
            </ul>
          </div>
        </div>
        <p className="mt-16 border-t border-black/5 pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Storefront — created → paid → packed → shipped → delivered.
        </p>
      </div>
    </footer>
  );
}
