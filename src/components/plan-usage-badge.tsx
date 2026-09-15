import { AlertTriangle } from "lucide-react";

type Props = {
  label: string;
  used: number;
  limit: number;
  className?: string;
};

export function PlanUsageBadge({ label, used, limit, className }: Props) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const hit = used >= limit;
  const near = !hit && pct >= 80;
  const tone = hit
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : near
    ? "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300"
    : "bg-[color:var(--panel-2)] text-muted-foreground border-[color:var(--hairline)]";
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-medium ${tone} ${className ?? ""}`}>
      <span className="tabular-nums">
        {used}/{limit}
      </span>
      <span className="opacity-80">{label}</span>
      {hit && <AlertTriangle className="size-3.5" />}
    </div>
  );
}
