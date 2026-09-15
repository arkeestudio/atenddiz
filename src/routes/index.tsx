import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageSquareText, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";

// Tela inicial: só o acesso ao sistema.
// A página de vendas continua guardada em src/components/landing/SalesLanding.tsx.
export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [{ title: `${brand.name} — Entrar` }] }),
  component: Inicio,
});

function Inicio() {
  return (
    <div className="min-h-screen w-full grid place-items-center bg-background text-foreground px-5">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-16 rounded-2xl grid place-items-center bg-gradient-brand text-primary-foreground shadow-[0_10px_30px_-10px_rgba(22,163,74,.6)]">
            <MessageSquareText className="size-8" strokeWidth={2.4} />
          </div>
          <div className="font-display font-extrabold text-3xl text-gradient-brand leading-none">{brand.name}</div>
        </div>

        <Button
          asChild
          size="lg"
          className="h-12 px-10 bg-gradient-brand text-primary-foreground hover:opacity-95 font-semibold text-[15px] shadow-[0_8px_24px_-10px_rgba(22,163,74,.6)]"
        >
          <Link to="/entrar" search={{ modo: "login" }}>
            <LogIn className="size-4 mr-2" /> Entrar
          </Link>
        </Button>
      </div>
    </div>
  );
}
