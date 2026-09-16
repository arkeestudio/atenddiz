import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function initials(s: string | null | undefined): string {
  if (!s) return "??";
  const parts = s.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function InitialsAvatar({
  name,
  size = 36,
  className,
  forceGradient,
  variant = "brand",
  src,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
  /** @deprecated kept for backward compatibility — ignored unless variant="solid" */
  forceGradient?: string;
  variant?: "brand" | "solid";
  /** Foto de perfil do WhatsApp; se falhar (link expirado), cai nas iniciais. */
  src?: string | null;
}) {
  const key = (name || "?").trim();
  const [imgOk, setImgOk] = useState(!!src);
  useEffect(() => { setImgOk(!!src); }, [src]);

  if (src && imgOk) {
    return (
      <img
        src={src}
        alt={key}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setImgOk(false)}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-[rgba(37,211,102,.25)]", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const fontSize = Math.max(11, Math.round(size * 0.38));
  const style =
    variant === "solid" && forceGradient
      ? { width: size, height: size, background: forceGradient, fontSize, color: "#04140B" }
      : {
          width: size,
          height: size,
          background: "rgba(37,211,102,.15)",
          color: "#9af0bd",
          fontSize,
        };
  return (
    <div
      className={cn(
        "shrink-0 rounded-full grid place-items-center font-display font-semibold ring-1 ring-[rgba(37,211,102,.25)]",
        className,
      )}
      style={style}
    >
      {initials(key)}
    </div>
  );
}
