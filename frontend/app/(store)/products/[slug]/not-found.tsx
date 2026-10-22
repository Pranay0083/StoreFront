import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ProductNotFound() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-32 text-center sm:px-8">
      <h1 className="font-serif text-4xl">This piece doesn&apos;t exist.</h1>
      <Button asChild className="mt-6">
        <Link href="/products">Back to the collection</Link>
      </Button>
    </div>
  );
}
