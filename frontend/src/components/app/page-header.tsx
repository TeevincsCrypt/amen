export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}
