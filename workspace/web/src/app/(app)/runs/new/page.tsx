import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RunForm } from '@/features/runs/components/run-form';

export default function NewRunPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New research run"
        breadcrumbs={[{ label: 'Research Runs', href: '/runs' }, { label: 'New' }]}
        description="Describe the question in business terms. The backend owns the tool budget, the deterministic anomaly rules and the financial policy; the console only submits the request and follows it."
      />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <RunForm />
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What happens after submission</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-muted">
                <li>The API answers <code className="font-mono">202 Accepted</code> with a run id, without waiting for execution.</li>
                <li>The worker executes a bounded agent: tool calls, then deterministic anomaly detection.</li>
                <li>If a refund is proposed above the policy threshold, the run pauses and an approval request is created.</li>
                <li>An authorised reviewer decides; only an approval can lead to a simulated settlement.</li>
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Duplicate submissions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted">
              <p>
                Every submission carries an idempotency key. If the network drops mid-request, retrying the same key returns the original run
                rather than starting a second one.
              </p>
              <p className="mt-2">
                You can always check what was actually created on the{' '}
                <Link href="/runs" className="font-medium text-primary hover:underline">
                  research runs
                </Link>{' '}
                list.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
