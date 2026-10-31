import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/** Red border on a field the form has marked invalid; pass to the Input or Textarea. */
export const INVALID = 'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive';

/**
 * A label above its control, a limit beside the label when the field has one, and the error under it.
 * The hint and the error are tied to the control with `aria-describedby`, so a screen reader hears them.
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <span id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
