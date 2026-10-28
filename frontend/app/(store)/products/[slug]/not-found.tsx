import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ProductNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[1760px] flex-col justify-center px-4 py-24 sm:px-8">
      <h1 className="max-w-[14ch] animate-rise text-balance text-display-lg font-extrabold">This piece is not in the collection</h1>
      <p className="mt-6 max-w-[44ch] animate-rise text-lg [animation-delay:80ms]">
        It may have sold through, or the link may be mistyped. Everything we stock today is in the catalogue.
      </p>
      <Button asChild size="lg" className="mt-8 w-fit animate-rise [animation-delay:160ms]">
        <Link href="/products">Back to the collection</Link>
      </Button>
    </div>
  );
}
