import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The review/upload status pill.
 *
 * Colour carries meaning here — a confident wrong answer before an irreversible upload
 * is worse than none — so each tone is a distinct, calm hue rather than a saturated
 * shout. `blocked` reuses the destructive token; everything else rides the status-*
 * tokens defined in index.css.
 */
const statusBadge = cva('', {
  variants: {
    tone: {
      new: 'bg-status-new text-status-new-foreground',
      revision: 'bg-status-revision text-status-revision-foreground',
      duplicate: 'bg-status-duplicate text-status-duplicate-foreground',
      older: 'bg-status-older text-status-older-foreground',
      unknown: 'bg-status-unknown text-status-unknown-foreground',
      blocked: 'bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: { tone: 'new' },
});

export type StatusTone = NonNullable<VariantProps<typeof statusBadge>['tone']>;

export function StatusBadge({
  tone,
  className,
  children,
}: {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return <Badge className={cn(statusBadge({ tone }), 'rounded-md', className)}>{children}</Badge>;
}
