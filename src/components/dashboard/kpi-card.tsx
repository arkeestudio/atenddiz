import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp } from "lucide-react";

export function KpiCard({
  icon, label, value, trend, accent, className,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // min-w-0 + truncate: sem isso um valor ou legenda longa estica a coluna do grid
        // e empurra a pagina inteira para fora da tela.
        "rounded-2xl border p-6 min-w-0",
        accent
          ? "border-[rgba(37,211,102,.3)] bg-[linear-gradient(160deg,rgba(37,211,102,.14),rgba(37,211,102,.02))]"
          : "border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[14px] font-medium text-foreground/80">
        <span className="grid place-items-center text-[var(--brand-strong)]">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display font-extrabold mt-3 tracking-tight leading-none truncate" style={{ fontSize: 38 }}>
        {value}
      </div>
      {trend && (
        <div className="text-[13px] mt-3 text-[var(--brand-strong)] flex items-center gap-1.5 font-medium">
          <TrendingUp className="size-3.5 shrink-0" />
          <span className="truncate">{trend}</span>
        </div>
      )}
    </div>
  );
}
