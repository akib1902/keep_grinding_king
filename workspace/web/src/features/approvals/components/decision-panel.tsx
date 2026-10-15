'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Lock, ShieldAlert, XCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/feedback/toast';
import { DefinitionList } from '@/components/data-display/definition-list';
import { useDecideApproval } from '@/features/approvals/hooks';
import { useSession } from '@/features/auth/session-provider';
import { describeApiError } from '@/lib/errors';
import { formatCountdown, formatDateTime, formatMoney } from '@/lib/formatters';
import { APPROVAL_STALE_WINDOW_MS } from '@/lib/config';
import type { ApprovalDetail } from '@/types/api';

export interface DecisionPanelProps {
  approval: ApprovalDetail;
  /** Called after the backend confirms the decision, so the page can refetch. */
  onDecided?: () => void;
}

/**
 * Decision panel (FDD §7.6, §12.4).
 *
 * Three product rules are implemented literally here:
 *  - the confirmation dialog restates the exact supplier, amount, currency and
 *    proposal id being authorised,
 *  - an approved response is never rendered as a settlement — the copy says the
 *    decision was recorded and settlement is a separate, later event,
 *  - the panel is hidden for roles that cannot decide, while the copy states that
 *    the backend is what actually authorises the action.
 */
export function DecisionPanel({ approval, onDecided }: DecisionPanelProps) {
  const { canDecide, role } = useSession();
  const toast = useToast();
  const decide = useDecideApproval();
  const [pendingDecision, setPendingDecision] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [recorded, setRecorded] = useState<'APPROVE' | 'REJECT' | null>(null);

  const expiresInMs = Date.parse(approval.expiresAt) - Date.now();
  const expired = expiresInMs <= 0;
  const staling = !expired && expiresInMs <= APPROVAL_STALE_WINDOW_MS;
  const actionable = approval.status === 'PENDING' && !expired && canDecide;

  const submit = (): void => {
    if (!pendingDecision) return;
    decide.mutate(
      { approvalId: approval.approvalId, decision: pendingDecision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: (result) => {
          setRecorded(pendingDecision);
          setPendingDecision(null);
          setReason('');
          onDecided?.();
          toast.toast({
            tone: result.status === 'APPROVED' ? 'success' : 'neutral',
            title: `Decision recorded: ${result.status}`,
            description:
              'The decision is durably recorded. Settlement — if it happens — is a separate operation the backend commits afterwards.',
            durationMs: 10_000,
          });
        },
        onError: (error) => {
          toast.toast({ tone: 'danger', title: 'The decision was not recorded', description: describeApiError(error), durationMs: 10_000 });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
        {approval.status === 'PENDING' ? (
          <span className={staling ? 'text-xs font-medium text-warning' : 'text-xs text-muted'}>
            {expired ? 'Expired' : `Expires in ${formatCountdown(approval.expiresAt)}`}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!canDecide ? (
          <Alert tone="neutral" role="note" title="Your role cannot record a decision">
            <p className="flex items-start gap-2">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Signed in as <strong>{role}</strong>. Decision buttons are hidden because this role does not hold the{' '}
                <code className="font-mono">approvals:decide</code> permission. Hiding them is a convenience, not the control: the backend
                rejects the request with <code className="font-mono">403 FORBIDDEN</code> even if it is invoked directly.
              </span>
            </p>
          </Alert>
        ) : null}

        {approval.status !== 'PENDING' ? (
          <Alert tone={approval.status === 'APPROVED' ? 'success' : 'neutral'} role="status" title={`This approval is ${approval.status}`}>
            {approval.status === 'APPROVED'
              ? 'The proposal is authorised. Settlement is committed separately and is shown on the settlement ledger only once it commits.'
              : 'No settlement can result from this approval request.'}
          </Alert>
        ) : null}

        {expired && approval.status === 'PENDING' ? (
          <Alert tone="warning" role="status" title="This approval request has passed its expiry">
            A pending request past its expiry is presented as non-actionable. The backend decides whether an expired request may still be decided;
            the console does not assume it can.
          </Alert>
        ) : null}

        {staling ? (
          <Alert tone="warning" role="status" title="This request is close to expiry">
            Review it now, or let it expire — an expired request cannot settle. Proposal revision {approval.proposalRevision}; any change to the
            reviewed fields would invalidate this request.
          </Alert>
        ) : null}

        {recorded ? (
          <Alert tone={recorded === 'APPROVE' ? 'success' : 'neutral'} role="status" title="Decision recorded by the backend">
            <p className="flex items-start gap-2">
              {recorded === 'APPROVE' ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <XCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span>
                The run is resuming in the background. Whether it reaches <code className="font-mono">COMPLETED</code> and whether a simulated
                settlement commits is determined by the backend — this screen will re-read both and show the recorded outcome.
              </span>
            </p>
          </Alert>
        ) : null}

        {actionable ? (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium text-foreground">Record a decision</legend>
              <Field
                label="Reason (optional)"
                htmlFor="decision-reason"
                hint="Stored with the decision and shown on the audit trail."
              >
                <Textarea
                  id="decision-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value.slice(0, 500))}
                  maxLength={500}
                  className="min-h-16"
                  placeholder="e.g. Duplicate invoice confirmed with the supplier."
                />
              </Field>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="success" onClick={() => setPendingDecision('APPROVE')} disabled={decide.isPending}>
                <CheckCircle2 aria-hidden="true" />
                Approve proposal
              </Button>
              <Button variant="secondary" onClick={() => setPendingDecision('REJECT')} disabled={decide.isPending}>
                <XCircle aria-hidden="true" />
                Reject proposal
              </Button>
              {decide.isPending ? <span className="text-sm text-muted">Recording the decision…</span> : null}
            </div>

            <p className="text-xs text-muted">
              Approving authorises the refund proposal. It does not transfer funds: settlement is a separate simulated operation, and the console
              never marks a proposal authorised or settled on its own.
            </p>
          </>
        ) : null}

        <DefinitionList
          columns={2}
          items={[
            { term: 'Approval status', value: approval.status },
            { term: 'Proposal revision', value: String(approval.proposalRevision), mono: true },
            { term: 'Reviewed hash', value: approval.proposalHash.slice(0, 16), mono: true },
            { term: 'Expiry', value: formatDateTime(approval.expiresAt), mono: true },
            ...(approval.decidedAt ? [{ term: 'Decided', value: formatDateTime(approval.decidedAt), mono: true }] : []),
            ...(approval.decidedBy ? [{ term: 'Decided by', value: approval.decidedBy.slice(0, 8), mono: true }] : []),
            ...(approval.reason ? [{ term: 'Recorded reason', value: approval.reason }] : []),
          ]}
        />

        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/refund-proposals/${approval.proposalId}`} className="font-medium text-primary hover:underline">
            Open the full proposal
          </Link>
          <Link href={`/runs/${approval.runId}`} className="font-medium text-primary hover:underline">
            Open the run
          </Link>
        </div>
      </CardContent>

      <Dialog
        open={pendingDecision !== null}
        onClose={() => (decide.isPending ? undefined : setPendingDecision(null))}
        busy={decide.isPending}
        title={pendingDecision === 'APPROVE' ? 'Authorise this refund proposal?' : 'Reject this refund proposal?'}
        description="Check the financial detail before it is recorded. This decision is written to the audit trail."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDecision(null)} disabled={decide.isPending}>
              Go back
            </Button>
            <Button
              variant={pendingDecision === 'APPROVE' ? 'success' : 'danger'}
              onClick={submit}
              disabled={decide.isPending}
            >
              {decide.isPending
                ? 'Recording…'
                : pendingDecision === 'APPROVE'
                  ? 'Yes, approve this amount'
                  : 'Yes, reject this proposal'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="tnum text-2xl font-semibold text-foreground">
            {formatMoney(approval.reviewed.amountMinor, approval.reviewed.currency)}
          </p>
          <DefinitionList
            columns={1}
            items={[
              { term: 'Supplier', value: approval.reviewed.supplierName ?? `${approval.reviewed.supplierId} (name not exposed by the API)` },
              { term: 'Proposal identifier', value: approval.proposalId, mono: true },
              { term: 'Source transaction', value: approval.reviewed.transactionId, mono: true },
              { term: 'Refundable at creation', value: formatMoney(approval.reviewed.refundableAmountMinor, approval.reviewed.currency), mono: true },
              { term: 'Policy', value: `${approval.reviewed.policyVersion} → ${approval.reviewed.policyOutcome}` },
            ]}
          />
          {pendingDecision === 'REJECT' ? (
            <Alert tone="neutral" role="note" title="Rejecting settles nothing">
              <p className="flex items-start gap-2">
                <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>The run finishes with a report stating that no refund was authorised. No ledger entry is written.</span>
              </p>
            </Alert>
          ) : null}
        </div>
      </Dialog>
    </Card>
  );
}
