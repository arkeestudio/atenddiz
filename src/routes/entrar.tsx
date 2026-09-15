import { createFileRoute, redirect, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  MessageSquareText,
  Sparkles,
  Loader2,
  Bot,
  KanbanSquare,
  ShieldCheck,
  Zap,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";
import { brand } from "@/config/brand";

type Search = { modo?: "login" | "signup"; plano?: string };

export const Route = createFileRoute("/entrar")({
  ssr: false,
  head: () => ({ meta: [{ title: `${brand.name} — Começar` }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    // Padrão: login. O cadastro (fluxo de venda) só abre com ?modo=signup explícito.
    modo: s.modo === "signup" ? "signup" : "login",
    plano: typeof s.plano === "string" ? s.plano : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const dest = search.plano ? `/app/checkout?plano=${encodeURIComponent(search.plano)}` : "/app/dashboard";
      throw redirect({ href: dest });
    }
  },
  component: EntrarPage,
});

const PLAN_LABEL: Record<string, { nome: string; preco: string }> = {
  starter: { nome: "Starter", preco: "R$ 97/mês" },
  pro: { nome: "Pro", preco: "R$ 197/mês" },
  business: { nome: "Business", preco: "R$ 497/mês" },
};

const emailSchema = z.string().email("E-mail inválido");

function genStrongPassword() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return "Az9!" + btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, "x").slice(0, 28);
}

function EntrarPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/entrar" }) as Search;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(search.modo === "login");
  const [loading, setLoading] = useState(false);

  const planInfo = search.plano ? PLAN_LABEL[search.plano] : null;
  // Textos de venda (painel lateral, "criar conta") só aparecem no fluxo de cadastro.
  const modoVenda = search.modo === "signup";

  async function routeAfterAuth() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (search.plano) {
      navigate({ to: "/app/checkout", search: { plano: search.plano } as any, replace: true });
      return;
    }
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    if (roles?.some((r) => r.role === "super_admin")) {
      navigate({ to: "/master/painel", replace: true });
      return;
    }
    const { data: cu } = await supabase.from("company_user").select("company_id").eq("user_id", u.user.id).eq("ativo", true).maybeSingle();
    navigate({ href: cu ? "/app/dashboard" : "/app/checkout", replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = emailSchema.safeParse(email);
    if (!v.success) return toast.error(v.error.issues[0].message);
    setLoading(true);

    if (needsPassword) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) return toast.error("Senha incorreta. Tente novamente ou recupere sua senha.");
      toast.success("Bem-vindo de volta!");
      return routeAfterAuth();
    }

    const generated = genStrongPassword();
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password: generated,
      options: { emailRedirectTo: window.location.origin + (search.plano ? `/app/checkout?plano=${search.plano}` : "/app/dashboard") },
    });

    if (signUpErr) {
      const msg = (signUpErr.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        setNeedsPassword(true);
        setLoading(false);
        toast.message("Já existe uma conta com esse e-mail.", { description: "Digite sua senha para continuar." });
        return;
      }
      if (msg.includes("signups not allowed") || msg.includes("signup_disabled") || msg.includes("signup is disabled")) {
        setNeedsPassword(true);
        setLoading(false);
        toast.message("Cadastros novos estão desativados.", { description: "Se você já tem conta, digite sua senha para entrar." });
        return;
      }
      setLoading(false);
      return toast.error(signUpErr.message);
    }

    if (signUpData.session) {
      setLoading(false);
      toast.success("Conta criada! Vamos para o pagamento.");
      return routeAfterAuth();
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: generated });
    setLoading(false);
    if (signInErr) {
      toast.success("Enviamos um link de confirmação para o seu e-mail.");
      return;
    }
    toast.success("Conta criada!");
    routeAfterAuth();
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-background text-foreground">
      {/* Ambient glows — same vibe as LP */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full blur-3xl opacity-40"
          style={{ background: "radial-gradient(circle, #25D366 0%, transparent 60%)" }}
        />
        <div
          className="absolute top-[30%] -right-40 h-[700px] w-[700px] rounded-full blur-3xl opacity-25"
          style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 65%)" }}
        />
        <div
          className="absolute bottom-[-200px] left-1/3 h-[500px] w-[500px] rounded-full blur-3xl opacity-20"
          style={{ background: "radial-gradient(circle, #16A34A 0%, transparent 60%)" }}
        />
      </div>

      <div className={`relative z-10 min-h-screen grid ${modoVenda ? "lg:grid-cols-[1.05fr_1fr]" : ""}`}>
        {/* LEFT — brand pane (hidden on mobile) */}
        {modoVenda && <aside className="hidden lg:flex flex-col justify-between p-10 xl:p-14 border-r border-[color:var(--hairline)] bg-[linear-gradient(160deg,rgba(22,163,74,.10),rgba(34,211,238,.04)_55%,transparent)]">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="size-4" />
              voltar ao site
            </Link>
          </div>

          <div className="space-y-8 max-w-lg">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-2xl grid place-items-center bg-gradient-brand text-primary-foreground shadow-[0_10px_30px_-10px_rgba(22,163,74,.6)] ring-1 ring-white/20">
                <MessageSquareText className="size-6" strokeWidth={2.4} />
              </div>
              <div>
                <div className="font-display font-extrabold text-2xl text-gradient-brand leading-none">{brand.name}</div>
                <div className="text-[12px] text-muted-foreground mt-1">{brand.tagline}</div>
              </div>
            </div>

            <h1 className="font-display text-4xl xl:text-5xl font-extrabold leading-[1.05] tracking-tight">
              Sua IA atende o<br />
              <span className="text-gradient-brand">WhatsApp 24h</span> e<br />
              organiza o CRM sozinha.
            </h1>

            <p className="text-[15px] text-muted-foreground leading-relaxed">
              Conecte seu número em 2 minutos. A gente cuida do resto — respostas, qualificação e movimentação dos leads no funil, no automático.
            </p>

            <div className="grid gap-3">
              <Feature icon={<Bot className="size-4" />} title="IA treinada no seu negócio" desc="Responde no seu tom, sem parecer robô." />
              <Feature icon={<KanbanSquare className="size-4" />} title="CRM Kanban inteligente" desc="Cada lead se move sozinho pelo funil." />
              <Feature icon={<Zap className="size-4" />} title="Pronto em 2 minutos" desc="Escaneou o QR, já está atendendo." />
            </div>

            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-[color:var(--brand)]" /> LGPD-friendly</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-[color:var(--brand)]" /> Sem cartão p/ testar</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-[color:var(--brand)]" /> Cancele quando quiser</span>
            </div>
          </div>

          <div className="text-[12px] text-muted-foreground">
            © {new Date().getFullYear()} {brand.name}. Todos os direitos reservados.
          </div>
        </aside>}

        {/* RIGHT — form */}
        <main className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
          {/* Mobile brand header */}
          <div className={`${modoVenda ? "lg:hidden " : ""}w-full max-w-md mb-6 flex items-center justify-between`}>
            <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> voltar
            </Link>
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-xl grid place-items-center bg-gradient-brand text-primary-foreground shadow-md">
                <MessageSquareText className="size-4" />
              </div>
              <div className="font-display font-bold text-[15px] text-gradient-brand">{brand.name}</div>
            </div>
          </div>

          <div className="w-full max-w-md">
            <div className="relative panel p-7 sm:p-8 glow-brand overflow-hidden">
              {/* corner accent */}
              <div
                aria-hidden
                className="absolute -top-24 -right-24 size-56 rounded-full blur-3xl opacity-50"
                style={{ background: "radial-gradient(circle, rgba(22,163,74,.35) 0%, transparent 70%)" }}
              />

              <div className="relative">
                {planInfo && (
                  <div className="mb-5 rounded-xl border border-[color:var(--brand)]/30 bg-[color:var(--brand-soft)] p-4">
                    <div className="flex items-center gap-2 text-[11px] uppercase font-bold tracking-[0.14em] text-[color:var(--brand-text)]">
                      <Sparkles className="size-3.5" /> Plano escolhido
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <div className="font-display text-lg font-bold">{planInfo.nome}</div>
                      <div className="text-sm font-semibold">{planInfo.preco}</div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">3 dias grátis • cancele antes e não paga nada</div>
                  </div>
                )}

                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[color:var(--brand-soft)] border border-[color:var(--brand)]/20 text-[11px] font-semibold text-[color:var(--brand-text)] mb-3">
                  <span className="size-1.5 rounded-full bg-[color:var(--brand)] dot-pulse" />
                  {needsPassword ? "Acesso à conta" : "Cadastro em 1 clique"}
                </div>

                <h1 className="font-display text-[26px] sm:text-[28px] font-extrabold leading-tight tracking-tight">
                  {needsPassword ? "Bem-vindo de volta" : "Comece em 1 clique"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1.5 mb-6">
                  {needsPassword
                    ? "Você já tem conta — informe sua senha pra continuar."
                    : "Só precisamos do seu e-mail. Criamos a conta na hora e te levamos pro próximo passo."}
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      placeholder="voce@empresa.com"
                      className="h-11"
                    />
                  </div>

                  {needsPassword && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="pwd">Senha</Label>
                        <Link to="/esqueci-senha" className="text-[11.5px] font-medium text-muted-foreground hover:text-[color:var(--brand-text)] transition-colors">
                          Esqueci minha senha
                        </Link>
                      </div>
                      <Input id="pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required className="h-11" />
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={loading}
                    size="lg"
                    className="w-full h-12 bg-gradient-brand text-primary-foreground hover:opacity-95 font-semibold text-[14.5px] shadow-[0_8px_24px_-10px_rgba(22,163,74,.6)]"
                  >
                    {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                    {needsPassword ? "Entrar e continuar" : planInfo ? "Continuar para o pagamento" : "Criar conta grátis"}
                  </Button>

                  {!needsPassword && (
                    <p className="text-[11.5px] text-muted-foreground text-center pt-1 leading-relaxed">
                      Sem cartão para começar os <span className="font-semibold text-foreground">3 dias grátis</span>. Cancele quando quiser.
                    </p>
                  )}

                  {modoVenda && <div className="text-center pt-2 border-t border-[color:var(--hairline)] mt-2">
                    {needsPassword ? (
                      <button
                        type="button"
                        onClick={() => setNeedsPassword(false)}
                        className="text-[12.5px] text-muted-foreground hover:text-foreground transition-colors pt-2"
                      >
                        Não tem conta?{" "}
                        <span className="font-semibold text-[color:var(--brand-text)]">Criar agora</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setNeedsPassword(true)}
                        className="text-[12.5px] text-muted-foreground hover:text-foreground transition-colors pt-2"
                      >
                        Já tem conta?{" "}
                        <span className="font-semibold text-[color:var(--brand-text)]">Entrar</span>
                      </button>
                    )}
                  </div>}
                </form>
              </div>
            </div>

            <p className="text-[11.5px] text-muted-foreground text-center mt-5">
              Ao continuar, você concorda com nossos{" "}
              <Link to="/termos" className="underline underline-offset-2 hover:text-foreground">Termos</Link>{" "}
              e{" "}
              <Link to="/privacidade" className="underline underline-offset-2 hover:text-foreground">Política de privacidade</Link>.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--panel)]/60 backdrop-blur-sm p-3.5">
      <div className="size-9 rounded-lg grid place-items-center bg-[color:var(--brand-soft)] text-[color:var(--brand-text)] shrink-0 ring-1 ring-[color:var(--brand)]/15">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-[13.5px] leading-tight">{title}</div>
        <div className="text-[12px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
