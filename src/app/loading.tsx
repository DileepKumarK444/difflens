export default function Loading() {
  return (
    <div role="status" className="mx-auto max-w-5xl animate-pulse space-y-3 py-2" aria-label="Loading">
      <div className="h-6 w-40 rounded bg-muted" />
      <div className="h-4 w-72 rounded bg-muted" />
      <div className="mt-6 h-24 rounded-lg bg-muted" />
    </div>
  );
}
