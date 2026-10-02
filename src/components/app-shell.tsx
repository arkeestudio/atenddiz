import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Bot, KanbanSquare, Table2, LogOut, Smartphone, Shield,
  Inbox, Users, BarChart3, Settings, Contact, Zap, MessageCircle, Megaphone, Webhook, Wallet,
  ChevronsLeft, ChevronsRight,
} from "lucide-react";

// Barra lateral recolhida (só ícones) libera ~190px para a área de trabalho — faz diferença
// em notebook, onde Conversas e o Kanban disputam cada pixel. A escolha fica no navegador.
const CHAVE_BARRA = "ui:barra-recolhida";
import { supabase } from "@/integrations/supabase/client";
import { brand, supportWhatsappUrl, supportWhatsappDisplay } from "@/config/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileBottomNav, type MobileNavItem } from "@/components/mobile-bottom-nav";
import { toast } from "sonner";
import type { CompanyRow, Membership } from "@/lib/tenant";
import { useWhatsappStatus } from "@/hooks/use-whatsapp-status";
import { useAguardandoHumano } from "@/hooks/use-aguardando-humano";

type NavItem = {
  to: string;
  label: string;
  icon: any;
  adminOnly?: boolean;
  tag?: string;
  badge?: boolean;
};

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "Atendimento",
    items: [
      { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/app/conversas", label: "Conversas", icon: Inbox, badge: true },
      { to: "/app/crm", label: "CRM Kanban", icon: KanbanSquare },
      { to: "/app/planilha", label: "Planilha de Leads", icon: Table2 },
      { to: "/app/campanhas", label: "Campanhas", icon: Megaphone, adminOnly: true },
      { to: "/app/agente", label: "Agente IA", icon: Bot, tag: "IA", adminOnly: true },
    ],
  },
  {
    label: "Gestão",
    items: [
      { to: "/app/contatos", label: "Contatos", icon: Contact },
      { to: "/app/financeiro", label: "Financeiro", icon: Wallet, adminOnly: true },
      { to: "/app/relatorios", label: "Relatórios", icon: BarChart3, adminOnly: true },
      { to: "/app/conexao", label: "Conexão", icon: Smartphone },
      { to: "/app/equipe", label: "Equipe", icon: Users, adminOnly: true },
      { to: "/app/integracoes", label: "Integrações", icon: Webhook, adminOnly: true },
      { to: "/app/configuracoes", label: "Configurações", icon: Settings, adminOnly: true },
    ],
  },
];

export function AppShell({
  children,
  company,
  membership,
  email,
  isSuperAdmin,
}: {
  children: ReactNode;
  company: CompanyRow | null;
  membership?: Membership | null;
  email?: string | null;
  isSuperAdmin?: boolean;
}) {
  const loc = useLocation();
  const navigate = useNavigate();
  const aguardandoHumano = useAguardandoHumano(company?.id);

  // Começa aberta no servidor e lê a preferência no cliente: sem acesso ao localStorage
  // durante o SSR, e um piscar de 190px na primeira pintura é melhor que hidratação divergente.
  const [recolhida, setRecolhida] = useState(false);
  useEffect(() => {
    try { setRecolhida(localStorage.getItem(CHAVE_BARRA) === "1"); } catch {}
  }, []);
  function alternarBarra() {
    setRecolhida((v) => {
      try { localStorage.setItem(CHAVE_BARRA, v ? "0" : "1"); } catch {}
      return !v;
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/entrar", replace: true });
  }

  const primary = company?.primary_color || brand.primary;
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  const roleLabel =
    membership?.role === "owner" ? "Dono"
    : membership?.role === "admin" ? "Admin"
    : membership?.role === "atendente" ? "Atendente"
    : "Membro";
  const userName = (email || "Você").split("@")[0];

  const mobileItems: MobileNavItem[] = [
    { to: "/app/dashboard", label: "Início", icon: LayoutDashboard },
    { to: "/app/conversas", label: "Conversas", icon: Inbox },
    { to: "/app/crm", label: "CRM", icon: KanbanSquare },
    { to: "/app/contatos", label: "Contatos", icon: Contact },
    isAdmin
      ? { to: "/app/agente", label: "Agente", icon: Bot }
      : { to: "/app/conexao", label: "Conexão", icon: Smartphone },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground" style={{ ["--brand" as any]: primary }}>
      {/* Sem avisos de venda (teste grátis / recarregar créditos): conta premium. */}
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-[color:var(--panel)]/80 backdrop-blur-xl border-b border-[color:var(--hairline)]">
        <div className="flex items-center gap-2.5 min-w-0">
          {company?.logo_url ? (
            <img src={company.logo_url} alt={company.nome} className="size-8 rounded-lg object-cover ring-1 ring-[color:var(--hairline)]" />
          ) : (
            <div
              className="size-8 rounded-lg grid place-items-center text-primary-foreground shrink-0"
              style={{ background: `linear-gradient(135deg, ${primary}, var(--brand-strong))` }}
            >
              <Zap className="size-4" strokeWidth={2.5} />
            </div>
          )}
          <div className="min-w-0">
            <div className="font-display font-bold tracking-tight text-[14.5px] leading-none truncate">{brand.name}</div>
            <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{company?.nome || "Sua empresa"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ThemeToggle />
          <button
            onClick={signOut}
            title="Sair"
            className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar
          loc={loc}
          company={company}
          isSuperAdmin={isSuperAdmin}
          isAdmin={isAdmin}
          primary={primary}
          userName={userName}
          email={email}
          roleLabel={roleLabel}
          signOut={signOut}
          aguardandoHumano={aguardandoHumano}
          recolhida={recolhida}
          alternar={alternarBarra}
        />
        {/* Sem barra no topo do conteúdo: status do WhatsApp, tema e usuário moram na barra
            lateral. São ~60px a mais de tela útil em toda página — em Conversas, é a diferença
            entre ver três mensagens a mais ou não. Com a barra recolhida o conteúdo vai mais largo. */}
        <main className={`flex-1 px-4 pt-4 pb-28 md:px-6 md:pt-4 md:pb-6 w-full mx-auto min-w-0 ${recolhida ? "max-w-[1600px]" : "max-w-7xl"}`}>
          {children}
        </main>
      </div>

      <MobileBottomNav items={mobileItems} accent={primary} />
    </div>
  );
}

function Sidebar({
  loc, company, isSuperAdmin, isAdmin, primary, userName, email, roleLabel, signOut, aguardandoHumano, recolhida, alternar,
}: any) {
  return (
    <aside
      className={`hidden md:flex relative min-h-screen border-r border-[color:var(--hairline)] bg-[color:var(--sidebar-bg)] flex-col shrink-0 transition-[width] duration-200 ${
        recolhida ? "w-[72px]" : "w-[260px]"
      }`}
    >
      {/* Botão na borda: visível sem ocupar espaço do menu. */}
      <button
        type="button"
        onClick={alternar}
        title={recolhida ? "Expandir menu" : "Recolher menu"}
        aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-7 z-10 size-6 grid place-items-center rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel)] text-muted-foreground shadow-sm hover:text-foreground hover:bg-[color:var(--panel-2)]"
      >
        {recolhida ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
      </button>

      <div className={`py-4 flex items-center gap-3 border-b border-[color:var(--hairline)] ${recolhida ? "px-0 justify-center" : "px-4"}`}>
        <div className="relative shrink-0">
          {company?.logo_url ? (
            <img src={company.logo_url} alt={company.nome} title={company?.nome} className="size-10 rounded-xl object-cover ring-1 ring-[color:var(--hairline)]" />
          ) : (
            <div
              title={company?.nome}
              className="size-10 rounded-xl grid place-items-center text-primary-foreground shadow-md ring-1 ring-[color:var(--hairline)]"
              style={{ background: `linear-gradient(135deg, ${primary}, var(--brand-strong))` }}
            >
              <Zap className="size-5" strokeWidth={2.5} />
            </div>
          )}
          {/* Recolhida: o status do WhatsApp vira um ponto no canto do logo. */}
          {recolhida && <WhatsappStatus compacto />}
        </div>
        {!recolhida && (
          <div className="min-w-0">
            <div className="font-display font-extrabold tracking-tight truncate text-[16px] leading-tight">{brand.name}</div>
            <div className="text-[11.5px] text-muted-foreground truncate">{company?.nome || "Sua empresa"}</div>
            <WhatsappStatus />
          </div>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${recolhida ? "p-2 space-y-3" : "p-3 space-y-5"}`}>
        {sections.map((sec, idx) => (
          <div key={sec.label}>
            {recolhida ? (
              idx > 0 && <div className="mx-2 mb-2 border-t border-[color:var(--hairline)]" aria-hidden />
            ) : (
              <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {sec.label}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {sec.items.filter((i) => !i.adminOnly || isAdmin).map((item) => (
                <NavLink key={item.to} item={item} active={loc.pathname.startsWith(item.to)} primary={primary}
                  count={item.badge ? aguardandoHumano : 0} compacto={recolhida} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={`border-t border-[color:var(--hairline)] ${recolhida ? "p-2" : "p-3"}`}>
        {isSuperAdmin && (
          <Link
            to="/master/painel"
            title="Painel Master"
            className={`mb-2 flex items-center gap-2 py-2 rounded-lg text-[13px] font-medium text-destructive hover:bg-[color:var(--panel-2)] ${recolhida ? "justify-center px-0" : "px-3"}`}
          >
            <Shield className="size-4" /> {!recolhida && "Painel Master"}
          </Link>
        )}
        {recolhida ? (
          <div className="flex flex-col items-center gap-2">
            <div
              title={`${userName} · ${roleLabel}`}
              className="size-9 rounded-full grid place-items-center text-[13px] font-bold text-[color:var(--brand-text)] ring-1 ring-[color:var(--hairline-strong)]"
              style={{ background: "var(--brand-soft)" }}
            >
              {(userName || "U").slice(0, 1).toUpperCase()}
            </div>
            <ThemeToggle />
            <button onClick={signOut} title="Sair" className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-[color:var(--panel-2)]">
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-[color:var(--panel-2)] border border-[color:var(--hairline)]">
              <div
                className="size-9 rounded-full grid place-items-center text-[13px] font-bold text-[color:var(--brand-text)] ring-1 ring-[color:var(--hairline-strong)] shrink-0"
                style={{ background: "var(--brand-soft)" }}
              >
                {(userName || "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold truncate">{userName}</div>
                <div className="text-[11px] text-muted-foreground truncate" title={email || ""}>{roleLabel}</div>
              </div>
              <ThemeToggle />
              <button onClick={signOut} title="Sair" className="size-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-[color:var(--panel)]">
                <LogOut className="size-4" />
              </button>
            </div>
            <a
              href={supportWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <MessageCircle className="size-3" />
              <span>Suporte: {supportWhatsappDisplay}</span>
            </a>
          </>
        )}
      </div>
    </aside>
  );
}

function NavLink({ item, active, primary, count = 0, compacto = false }: { item: NavItem; active: boolean; primary: string; count?: number; compacto?: boolean }) {
  const Icon = item.icon;
  // Recolhida: só o ícone, centralizado, com o nome no título (tooltip do navegador) e o
  // contador de "aguardando humano" como bolinha no canto — a informação não some, encolhe.
  if (compacto) {
    return (
      <Link
        to={item.to}
        title={count > 0 ? `${item.label} · ${count} aguardando atendimento humano` : item.label}
        aria-label={item.label}
        className={`relative grid place-items-center size-12 mx-auto rounded-lg transition-all ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-[color:var(--panel-2)]"
        }`}
        style={active ? { background: "var(--brand-soft)", boxShadow: `inset 0 0 0 1px var(--brand-soft-strong)` } : undefined}
      >
        <Icon className="size-[20px]" style={active ? { color: primary } : undefined} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full grid place-items-center text-[10px] font-bold bg-amber-500 text-black animate-pulse">
            {count}
          </span>
        )}
      </Link>
    );
  }
  return (
    <Link
      to={item.to}
      className={`relative flex items-center gap-3 px-3 py-[11px] rounded-lg text-[14.5px] font-medium whitespace-nowrap transition-all ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-[color:var(--panel-2)]"
      }`}
      style={
        active
          ? {
              background: "var(--brand-soft)",
              boxShadow: `inset 0 0 0 1px var(--brand-soft-strong), 0 0 22px -10px ${primary}`,
            }
          : undefined
      }
    >
      {active && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
          style={{ background: primary, boxShadow: `0 0 12px ${primary}` }}
        />
      )}
      <Icon className="size-[18px] shrink-0" style={active ? { color: primary } : undefined} />
      <span className="flex-1 truncate">{item.label}</span>
      {count > 0 && (
        <span
          title={`${count} aguardando atendimento humano`}
          className="min-w-[20px] h-5 px-1.5 rounded-full grid place-items-center text-[11px] font-bold bg-amber-500 text-black animate-pulse"
        >
          {count}
        </span>
      )}
      {item.tag && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded ring-1"
          style={{
            background: "var(--brand-soft)",
            color: "var(--brand-text)",
            borderColor: "var(--brand-soft-strong)",
          }}
        >
          {item.tag}
        </span>
      )}
    </Link>
  );
}

// Status do WhatsApp na barra lateral: linha pequena sob o nome da empresa ou, com a barra
// recolhida, um ponto no canto do logo. Clica e vai para Conexão.
function WhatsappStatus({ compacto = false }: { compacto?: boolean }) {
  const status = useWhatsappStatus();
  const connected = status === "connected";
  const connecting = status === "connecting";
  const label = connected ? "WhatsApp conectado" : connecting ? "Conectando…" : "WhatsApp desconectado";
  const color = connected ? "#16a34a" : connecting ? "#f59e0b" : "#dc2626";
  if (compacto) {
    return (
      <Link
        to="/app/conexao"
        title={label}
        aria-label={label}
        className="absolute -right-1 -bottom-1 size-3.5 rounded-full ring-2 ring-[color:var(--sidebar-bg)]"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    );
  }
  return (
    <Link to="/app/conexao" className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium hover:underline" style={{ color }} title="Abrir Conexão">
      <span className="size-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
