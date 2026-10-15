import Link from 'next/link';
import { Info } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

/**
 * Explains why a list view can be empty for a role that legitimately has access
 * to individual records.
 *
 * The backend scopes `GET /api/runs` to the caller's own runs, and the console
 * builds its global views from run history, so an approver (who owns no runs) sees
 * an empty list even though they can open any approval they are given. Saying so
 * is better than an empty table that looks like a bug.
 */
export function OwnerScopedListNotice({ view, alternative }: { view: string; alternative: { label: string; href: string } }) {
  return (
    <Alert tone="neutral" role="note" title={`${view} lists the runs your account can read`}>
      <p className="flex items-start gap-2">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          The API scopes the run list to runs you own, and this view is assembled from their recorded history. Individual records are still
          readable by identifier when your role is authorised for them —{' '}
          <Link href={alternative.href} className="font-medium text-primary hover:underline">
            {alternative.label}
          </Link>
          .
        </span>
      </p>
    </Alert>
  );
}
