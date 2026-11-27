// AURORA_PATCH: reusable WIP markers v1
import { cn } from '@/lib/utils';

export function WipBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center border border-red-800 bg-red-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300',
        className
      )}
    >
      [ WIP - Work In Progress ]
    </span>
  );
}

export function WipBanner({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border border-red-800 bg-red-950/40 px-3 py-2 text-[11px] leading-relaxed text-red-200',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <WipBadge />
        <span className="font-semibold text-red-300">
          This feature is still under active development.
        </span>
      </div>
      {children && <div className="mt-1.5 text-red-200/80">{children}</div>}
    </div>
  );
}
