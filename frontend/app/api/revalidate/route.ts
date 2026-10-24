import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

const TAG = /^[a-z][a-z-]*(:[A-Za-z0-9_.-]+)?$/;

function authorised(provided: string | null): boolean {
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!secret || !provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorised(req.headers.get('x-revalidate-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && TAG.test(t)).slice(0, 100) : [];
  if (!tags.length) return NextResponse.json({ error: 'Provide at least one valid tag' }, { status: 400 });
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: tags });
}
