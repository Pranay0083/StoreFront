'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <div className="relative aspect-[3/4] max-h-[80vh] w-full overflow-hidden bg-muted">
        <Image src={images[index] || images[0]} alt={title} fill priority sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <div className="mt-4 flex gap-3" role="group" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img}
              type="button"
              data-testid={`product-thumb-${i}`}
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              aria-pressed={i === index}
              className={cn(
                'relative h-24 w-20 overflow-hidden border transition-colors',
                i === index ? 'border-black' : 'border-transparent',
              )}
            >
              <Image src={img} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
