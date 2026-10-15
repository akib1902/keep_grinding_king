'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileSearch, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CopyableId, DefinitionList } from '@/components/data-display/definition-list';
import { PolicyCheckList } from '@/components/data-display/policy-checks';
import { ApprovalStatusBadge, ProposalStatusBadge, RunStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { DecisionPanel } from '@/features/approvals/components/decision-panel';
import { useSession } from '@/features/auth/session-provider';
import { useApproval } from '@/features/approvals/hooks';
import { useProposal } from '@/features/proposals/hooks';
import { useRun } from '@/features/runs/hooks';
import { ApiError } from '@/lib/errors';
import { formatDateTime, formatEvidenceValue, formatMoney, shortId } from '@/lib/formatters';
import { policyRuleLabel } from '@/lib/status';

/**
 * Approval detail (FDD §7.6).
 *
 * The layout is deliberate: proposal summary first, then the evidence that
 * supports it, then the decision. Nothing on this page is interactive until the
 * reviewer has seen the amount, currency and supplier being authorised.
 */
export default function ApprovalDetailPage() {
  const params = useParams<{ id: string }>();
  const approvalId = params?.id ?? null;
  const { canDecide } = useSession();

  const approvalQuery = useApproval(approvalId);
  const approval = approvalQuery.data ?? null;

  const proposalQuery = useProposal(approval?.proposalId ?? null);
  const runQuery = useRun(approval?.runId ?? null);
  const proposal = proposalQuery.data ?? null;
  const run = runQuery.data ?? null;

  const relatedFindings = useMemo(() => {
    if (!run?.result?.report || !approval) return [];
    return run.result.report.findings.filter((finding) =>
      finding.evidence.transactionIds.includes(approval.reviewed.transactionId),
    );
  }, [run, approval]);

  if (approvalQuery.isError) {
    const notFound = approvalQuery.error instanceof ApiError && approvalQuery.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Approval" breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: 'Not available' }]} />
        <ErrorState
          error={approvalQuery.error}
          onRetry={notFound ? undefined : () => void approvalQuery.refetch()}
          title={notFound ? 'Approval request not found' : 'The approval could not be loaded'}
          context={notFound ? 'It may belong to another tenant, or the identifier may be wrong.' : undefined}
        />
        <Link href="/approvals" className="text-sm font-medium text-primary hover:underline">
          ← Back to approvals
        </Link>
      </div>
    );
  }

  if (approvalQuery.isPending || !approval) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Loading approval…" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: shortId(approval.approvalId) }]}
        title="Refund proposal requiring approval"
        meta={
          <>
            <ApprovalStatusBadge status={approval.status} />
            {proposal ? <ProposalStatusBadge status={proposal.status} /> : null}
            {run ? <RunStatusBadge status={run.status} /> : null}
          </>
        }
        description={
          <span>
            {approval.reviewed.supplierName ?? `Supplier ${shortId(approval.reviewed.supplierId)}`} · policy{' '}
            {approval.reviewed.policyVersion} · requested {formatDateTime(proposal?.createdAt ?? approval.expiresAt)}
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
                Proposal summary
              </CardTitle>
              <Badge tone="warning">{approval.reviewed.policyOutcome}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted">Amount under review</p>
                <p className="tnum text-3xl font-semibold text-foreground">
                  {formatMoney(approval.reviewed.amountMinor, approval.reviewed.currency)}
                </p>
                <p className="text-sm text-muted">
                  Refundable balance for the source transaction at proposal time:{' '}
                  <span className="tnum">{formatMoney(approval.reviewed.refundableAmountMinor, approval.reviewed.currency)}</span>
                </p>
              </div>

              <DefinitionList
                columns={2}
                items={[
                  { term: 'Supplier', value: approval.reviewed.supplierName ?? <span className="font-mono">{approval.reviewed.supplierId}</span> },
                  { term: 'Supplier id', value: approval.reviewed.supplierId, mono: true },
                  { term: 'Source transaction', value: approval.reviewed.transactionId, mono: true },
                  { term: 'Proposal', value: <CopyableId value={approval.proposalId} label="proposal id" /> },
                  { term: 'Proposal revision', value: String(approval.proposalRevision), mono: true },
                  { term: 'Currency', value: approval.reviewed.currency, mono: true },
                ]}
              />

              <div>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Proposed refund justification</p>
                <p className="mt-1 text-sm whitespace-pre-line text-secondary">{approval.reviewed.justification}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSearch aria-hidden="true" className="size-4 text-muted" />
                Evidence
              </CardTitle>
              <span className="text-xs text-muted">Everything below is recorded evidence, not model opinion.</span>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {relatedFindings.length === 0 ? (
                runQuery.isError || !run ? (
                  <EmptyState
                    title="The run's research report is not readable by your role"
                    description="The backend authorises this approval to you but keeps the underlying run scoped to its owner, so the report's findings cannot be cross-referenced here. The proposal's own recorded evidence references below are the supporting detail for your decision."
                  />
                ) : (
                  <EmptyState
                    title="No finding in the report references this transaction"
                    description="The run's report does not contain a finding citing this transaction, so there is no matching anomaly evidence to display. The proposal's recorded evidence references are shown below."
                  />
                )
              ) : (
                <ul className="flex flex-col gap-4">
                  {relatedFindings.map((finding) => (
                    <li key={finding.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{finding.title}</span>
                        <Badge tone={finding.severity === 'HIGH' ? 'danger' : finding.severity === 'MEDIUM' ? 'warning' : 'info'}>
                          {finding.ruleId} · {finding.severity}
                        </Badge>
                      </div>
                      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-secondary">
                        {finding.observations.map((observation) => (
                          <li key={observation}>{observation}</li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted">
                        {finding.refundEligible
                          ? `Refund eligible up to ${formatMoney(finding.suggestedRefundMinor)}`
                          : 'No refund basis was derived from this finding by the rules'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Supporting record references</p>
                <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                  {Object.entries(approval.reviewed.evidence).map(([key, value]) => (
                    <div key={key} className="flex flex-col">
                      <dt className="text-[11px] tracking-wide text-muted uppercase">{key}</dt>
                      <dd className="font-mono text-[12px] break-all text-secondary">{formatEvidenceValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {proposal ? (
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Policy decision · {proposal.policy.version} ({proposal.policy.outcome})
                  </p>
                  <PolicyCheckList checks={proposal.policy.checks} className="mt-2" />
                  {proposal.policy.denyReasons.length > 0 ? (
                    <Alert tone="danger" role="alert" className="mt-3" title="Policy deny reasons">
                      {proposal.policy.denyReasons.map((reason) => policyRuleLabel(reason)).join(', ')}
                    </Alert>
                  ) : null}
                </div>
              ) : proposalQuery.isPending ? (
                <p className="text-sm text-muted">Loading the policy decision…</p>
              ) : (
                <Alert tone="neutral" role="note" title="Policy decision unavailable">
                  The proposal detail could not be loaded, so the rule-by-rule decision is not shown. The amount and supplier above come from the
                  snapshot taken when the approval was requested.
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <DecisionPanel approval={approval} onDecided={() => void approvalQuery.refetch()} />

          <Card>
            <CardHeader>
              <CardTitle>Related run</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {runQuery.isPending ? (
                <p className="text-sm text-muted">Loading the run…</p>
              ) : runQuery.isError && canDecide && (runQuery.error as ApiError | undefined)?.status === 404 ? (
                // The API authorises an approver on the approval record itself, not
                // on the analyst's run. Saying so is more useful than an error.
                <Alert tone="neutral" role="note" title="The underlying run is not readable by your role">
                  The backend authorises this approval request to the approver role, but the run it belongs to stays scoped to its owner. The
                  proposal detail below and the recorded history are the authoritative context for your decision.
                </Alert>
              ) : runQuery.isError ? (
                <ErrorState error={runQuery.error} onRetry={() => void runQuery.refetch()} title="The run could not be loaded" />
              ) : run ? (
                <>
                  <DefinitionList
                    columns={1}
                    items={[
                      { term: 'Run id', value: <CopyableId value={run.runId} label="run id" /> },
                      { term: 'Status', value: <RunStatusBadge status={run.status} size="sm" /> },
                      { term: 'Analysis window', value: `${run.request.from} → ${run.request.to}`, mono: true },
                      { term: 'Request', value: run.request.task },
                    ]}
                  />
                  <Link href={`/runs/${run.runId}`} className="text-sm font-medium text-primary hover:underline">
                    Open the run detail
                  </Link>
                </>
              ) : (
                <p className="text-sm text-muted">The associated run is not visible to your account.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Separation of duties</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted">
              <p>
                The analyst who submitted the run and the person who authorises the refund are different roles, and the backend enforces the split.
                Who decided is recorded on the approval, not inferred from this session.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
