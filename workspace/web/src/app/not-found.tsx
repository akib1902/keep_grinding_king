import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-start gap-3 p-10">
      <p className="font-mono text-xs text-muted">404</p>
      <h1 className="text-xl font-semibold text-foreground">This page does not exist</h1>
      <p className="text-sm text-muted">
        The route you requested is not part of the console. Nothing was changed by visiting it.
      </p>
      <Link
        href="/overview"
        className="mt-2 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        Back to overview
      </Link>
    </main>
  );
}
