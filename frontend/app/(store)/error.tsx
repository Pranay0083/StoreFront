'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-7xl px-5 py-32 text-center sm:px-8">
      <h1 ref={heading} tabIndex={-1} className="font-serif text-4xl outline-none">
        Something went wrong.
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load this page. {error.digest && <span className="font-mono">Reference {error.digest}.</span>}
      </p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
