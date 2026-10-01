import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { Loader2, MessageSquareText } from "lucide-react";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { brand, supportWhatsappUrl, supportWhatsappDisplay } from "@/config/brand";

export function RoutePendingComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-4">
        <div className="size-12 rounded-xl grid place-items-center bg-gradient-brand text-primary-foreground shadow-md">
          <MessageSquareText className="size-6" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Carregando {brand.name}…</span>
        </div>
      </div>
    </div>
  );
}

// A partir do router 1.170 o erro chega como `unknown`. Normaliza para Error.
export function RouteErrorComponent({ error: bruto, reset }: { error: unknown; reset: () => void }) {
  const error = bruto instanceof Error ? bruto : new Error(typeof bruto === "string" ? bruto : JSON.stringify(bruto));
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_default_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo deu errado. Tente novamente ou volte para a home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir para o início
          </a>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Precisa de ajuda?{" "}
          <a
            href={supportWhatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-medium"
          >
            Falar com suporte ({supportWhatsappDisplay})
          </a>
        </p>
      </div>
    </div>
  );
}
