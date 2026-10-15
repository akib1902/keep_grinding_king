'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CopyableId, DefinitionList } from '@/components/data-display/definition-list';
import { PolicyCheckList } from '@/components/data-display/policy-checks';
import { ApprovalStatusBadge, ProposalStatusBadge, SettlementStatusBadge, RunStatusBadge } from '@/components/data-display/status-badge';
import { ErrorState } from '@/components/data-display/states';
import { useProposal } from '@/features/proposals/hooks';
import { useApproval } from '@/features/approvals/hooks';
import { useRun } from '@/features/runs/hooks';
import { ApiError } from '@/lib/errors';
import { formatDateTime, formatEvidenceValue, formatMoney } from '@/lib/formatters';
import { policyRuleLabel, proposalStatusMeta } from '@/lib/status';

/**
 * Refund proposal detail (FDD §7.7).
 *
 * The status blocks are kept explicitly separate: proposal status, approval
 * status and settlement status each have their own panel, because conflating them
 * is exactly the misleading state the product must avoid.
 */
export default function RefundProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const proposalId = params?.id ?? null;

  const proposalQuery = useProposal(proposalId);
  const proposal = proposalQuery.data ?? null;
  const approvalQuery = useApproval(proposal?.approval?.approvalId ?? null);
  const runQuery = useRun(proposal?.runId ?? null);

  if (proposalQuery.isError) {
    const notFound = proposalQuery.error instanceof ApiError && proposalQuery.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Refund proposal" breadcrumbs={[{ label: 'Refund Proposals', href: '/refund-proposals' }, { label: 'Not available' }]} />
        <ErrorState
          error={proposalQuery.error}
          onRetry={notFound ? undefined : () => void proposalQuery.refetch()}
          title={notFound ? 'Refund proposal not found' : 'The proposal could not be loaded'}
        />
        <Link href="/refund-proposals" className="text-sm font-medium text-primary hover:underline">
          ← Back to proposals
        </Link>
      </div>
    );
  }

  if (proposalQuery.isPending || !proposal) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Loading proposal…" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  const supplierName = approvalQuery.data?.reviewed.supplierName ?? null;
  const statusMeta = proposalStatusMeta(proposal.status);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: 'Refund Proposals', href: '/refund-proposals' }, { label: proposal.proposalId.slice(0, 8) }]}
        title="Refund proposal"
        meta={
          <>
            <ProposalStatusBadge status={proposal.status} />
            {proposal.approval ? <ApprovalStatusBadge status={proposal.approval.status} /> : null}
            {proposal.settlement ? <SettlementStatusBadge status={proposal.settlement.status} /> : null}
          </>
        }
        description={statusMeta.description}
      />

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Proposal overview</CardTitle>
              <Badge tone="neutral">revision {proposal.revision}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted">Proposed refund</p>
                <p className="tnum text-3xl font-semibold text-foreground">{formatMoney(proposal.amountMinor, proposal.currency)}</p>
                <p className="text-sm text-muted">
                  Refundable balance at creation:{' '}
                  <span className="tnum">{formatMoney(proposal.refundableAmountMinor, proposal.currency)}</span>
                </p>
              </div>

              <DefinitionList
                columns={2}
                items={[
                  { term: 'Proposal id', value: <CopyableId value={proposal.proposalId} label="proposal id" /> },
                  { term: 'Run', value: <Link href={`/runs/${proposal.runId}`} className="font-mono text-primary hover:underline">{proposal.runId.slice(0, 8)}</Link> },
                  { term: 'Supplier', value: supplierName ?? <span className="font-mono">{proposal.supplierId}</span> },
                  { term: 'Supplier id', value: proposal.supplierId, mono: true },
                  { term: 'Source transaction', value: proposal.transactionId, mono: true },
                  { term: 'Created', value: formatDateTime(proposal.createdAt), mono: true },
                  { term: 'Reviewed hash', value: proposal.reviewedHash.slice(0, 24), mono: true },
                  { term: 'Requires approval', value: proposal.requiresApproval ? 'yes — policy threshold exceeded' : 'no' },
                ]}
              />

              <div>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Justification</p>
                <p className="mt-1 text-sm whitespace-pre-line text-secondary">{proposal.justification}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Supporting evidence</CardTitle>
              <span className="text-xs text-muted">Recorded references the proposal was built from.</span>
            </CardHeader>
            <CardContent>
              {Object.keys(proposal.evidence).length === 0 ? (
                <p className="text-sm text-muted">No evidence references were recorded with this proposal.</p>
              ) : (
                <DefinitionList
                  columns={2}
                  items={Object.entries(proposal.evidence).map(([key, value]) => ({
                    term: key,
                    value: formatEvidenceValue(value),
                    mono: true,
                  }))}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Policy decision</CardTitle>
              <span className="text-xs text-muted">
                Policy {proposal.policy.version} · outcome {proposal.policy.outcome}
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <PolicyCheckList checks={proposal.policy.checks} />
              {proposal.policy.denyReasons.length > 0 ? (
                <Alert tone="danger" role="alert" title="Denied by policy">
                  {proposal.policy.denyReasons.map((reason) => policyRuleLabel(reason)).join(', ')}. No settlement can result from this proposal.
                </Alert>
              ) : null}
              <p className="font-mono text-[11px] break-all text-muted">decision hash {proposal.policy.decisionHash}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Approval</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {proposal.approval ? (
                <>
                  <DefinitionList
                    columns={1}
                    items={[
                      { term: 'Status', value: <ApprovalStatusBadge status={proposal.approval.status} size="sm" /> },
                      { term: 'Approval id', value: <CopyableId value={proposal.approval.approvalId} label="approval id" /> },
                      { term: 'Expires', value: formatDateTime(proposal.approval.expiresAt), mono: true },
                      ...(approvalQuery.data?.decidedAt
                        ? [{ term: 'Decided', value: formatDateTime(approvalQuery.data.decidedAt), mono: true }]
                        : []),
                      ...(approvalQuery.data?.reason ? [{ term: 'Recorded reason', value: approvalQuery.data.reason }] : []),
                    ]}
                  />
                  <Link href={`/approvals/${proposal.approval.approvalId}`} className="text-sm font-medium text-primary hover:underline">
                    Open the approval request
                  </Link>
                </>
              ) : proposal.status === 'REQUIRES_APPROVAL' ? (
                <Alert tone="warning" role="status" title="Approval expected but not found">
                  The proposal reports that approval is required, yet no approval record was returned. Treat this as an operational incident rather
                  than assuming the proposal is authorised.
                </Alert>
              ) : (
                <p className="text-sm text-muted">
                  No human approval was required or recorded for this proposal. Proposals at or below the configured threshold do not raise an
                  approval request.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settlement</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {proposal.settlement ? (
                <>
                  <DefinitionList
                    columns={1}
                    items={[
                      { term: 'Status', value: <SettlementStatusBadge status={proposal.settlement.status} size="sm" /> },
                      { term: 'Operation id', value: <CopyableId value={proposal.settlement.operationId} label="operation id" /> },
                      {
                        term: 'Ledger entry',
                        value: proposal.settlement.ledgerEntryId ? (
                          <CopyableId value={proposal.settlement.ledgerEntryId} label="ledger entry id" />
                        ) : (
                          'No ledger entry written'
                        ),
                      },
                    ]}
                  />
                  <Link
                    href={`/ledger?operationId=${proposal.settlement.operationId}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Open in the settlement ledger
                  </Link>
                </>
              ) : (
                <p className="text-sm text-muted">
                  No settlement operation exists for this proposal. Approval alone does not write a ledger entry — settlement is a separate
                  simulated operation, and only a committed one appears on the ledger.
                </p>
              )}
              <p className="text-xs text-muted">All settlement in this deployment is simulated. No funds move.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Associated run</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {runQuery.isPending ? (
                <p className="text-sm text-muted">Loading the run…</p>
              ) : runQuery.isError ? (
                <ErrorState error={runQuery.error} onRetry={() => void runQuery.refetch()} title="The run could not be loaded" />
              ) : runQuery.data ? (
                <>
                  <DefinitionList
                    columns={1}
                    items={[
                      { term: 'Status', value: <RunStatusBadge status={runQuery.data.status} size="sm" /> },
                      { term: 'Window', value: `${runQuery.data.request.from} → ${runQuery.data.request.to}`, mono: true },
                      { term: 'Request', value: runQuery.data.request.task },
                    ]}
                  />
                  <Link href={`/runs/${runQuery.data.runId}`} className="text-sm font-medium text-primary hover:underline">
                    Open the run detail
                  </Link>
                </>
              ) : (
                <p className="text-sm text-muted">The associated run is not visible to your account.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
