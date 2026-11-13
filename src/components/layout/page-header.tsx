export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </header>
  );
}

export function NotBuilt({ phase, what }: { phase: number; what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">Not built yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {what} arrives in Phase {phase}.
      </p>
    </div>
  );
}
