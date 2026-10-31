import type { PolicyBlock, PolicyDocument } from '@storefront/contracts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const fmtPolicyDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function Block({ block }: { block: PolicyBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'list':
      return (
        <ul className="list-disc space-y-2 pl-6 marker:text-muted-foreground">
          {block.items.map(item => (
            <li key={item} className="pl-1">
              {item}
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <Table className="max-w-xl text-base">
          <caption className="mb-2 caption-top text-left text-base text-muted-foreground">{block.caption}</caption>
          <TableHeader className="static bg-transparent">
            <TableRow>
              {block.columns.map(c => (
                <TableHead key={c} className="px-0 pr-6 text-sm">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.map(row => (
              <TableRow key={row.join('|')}>
                {row.map((cell, i) => (
                  <TableCell key={i} className={i === 0 ? 'px-0 pr-6 font-semibold' : 'px-0 pr-6'}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
  }
}

/** One policy set as a document on the shop's paper: title, the short version, then each section. */
export function PolicyArticle({ doc }: { doc: PolicyDocument }) {
  return (
    <article data-testid={`policy-${doc.slug}`} className="edge-perforated bg-card px-5 pb-14 pt-12 sm:px-10 sm:pb-20 sm:pt-16 xl:px-16">
      <header className="max-w-[48rem]">
        <h1 className="animate-rise text-balance text-display-lg font-extrabold">{doc.title}</h1>
        <p className="mt-6 animate-rise text-xl leading-snug [animation-delay:80ms]">{doc.summary}</p>
        <p className="mt-4 text-base text-muted-foreground">
          Last updated <time dateTime={doc.lastUpdated}>{fmtPolicyDate(doc.lastUpdated)}</time>
        </p>
      </header>

      <section aria-labelledby="in-short" className="-mx-5 mt-12 bg-secondary px-5 py-6 sm:mx-0 sm:px-8 sm:py-8">
        <h2 id="in-short" className="text-xl font-bold tracking-[-0.02em]">
          In short
        </h2>
        <ul className="mt-4 max-w-[66ch] list-disc space-y-2 pl-6 text-lg leading-relaxed">
          {doc.keyPoints.map(point => (
            <li key={point} className="pl-1">
              {point}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-16 space-y-14 sm:mt-20 sm:space-y-16">
        {doc.sections.map(section => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="grid scroll-mt-24 grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-8"
          >
            <h2
              id={`${section.id}-heading`}
              className="text-balance text-2xl font-extrabold leading-tight tracking-[-0.03em] xl:col-span-4"
            >
              {section.heading}
            </h2>
            <div className="min-w-0 max-w-[66ch] space-y-4 text-lg leading-relaxed xl:col-span-8">
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
