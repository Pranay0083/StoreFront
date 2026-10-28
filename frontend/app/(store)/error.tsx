'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex min-h-[60vh] max-w-[1760px] flex-col justify-center px-4 py-24 sm:px-8">
      <h1 ref={heading} tabIndex={-1} className="max-w-[14ch] text-balance text-display-lg font-extrabold outline-none">
        This page did not load
      </h1>
      <p className="mt-6 max-w-[48ch] text-lg">
        Something went wrong on our side. Your bag is safe; try again, or carry on shopping.
        {error.digest && <span className="mt-2 block text-base text-muted-foreground">Reference {error.digest}</span>}
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Link href="/products" className="text-base font-semibold underline underline-offset-4">
          Go to the catalogue
        </Link>
      </div>
    </div>
  );
}
