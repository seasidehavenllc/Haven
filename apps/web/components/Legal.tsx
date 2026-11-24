export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-5 leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
      <header>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="text-sm text-muted">Last updated {updated}</p>
      </header>
      {children}
    </article>
  );
}
