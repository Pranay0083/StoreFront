'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** The photograph leads the page: one large frame, and the other views as small frames to switch to. */
export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-secondary">
        <Image
          src={images[index] || images[0]}
          alt={title}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 58vw"
          className="object-cover"
        />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-3" role="group" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img}
              type="button"
              data-testid={`product-thumb-${i}`}
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              aria-pressed={i === index}
              className="group relative h-28 w-[5.5rem] overflow-hidden bg-secondary transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              <Image
                src={img}
                alt=""
                fill
                sizes="88px"
                className={cn(
                  'object-cover transition-opacity duration-150',
                  i === index ? 'opacity-100' : 'opacity-50 group-hover:opacity-80',
                )}
              />
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 bottom-0 h-1 bg-foreground transition-transform duration-200 ease-out',
                  i === index ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
