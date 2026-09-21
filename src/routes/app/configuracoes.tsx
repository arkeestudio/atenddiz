import { createFileRoute, redirect } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Download, Shield, Wallet, Lock, Upload, Trash2, AlertTriangle } from "lucide-react";
import { brand } from "@/config/brand";
import { TemplatesTab } from "@/components/config/templates-tab";
import { HorariosTab } from "@/components/config/horarios-tab";
import { listAuditLog, exportLgpd } from "@/lib/security.functions";
import { finStatus, enableFinanceiro } from "@/lib/financeiro.functions";

export const Route = createFileRoute("/app/configuracoes")({
  head: () => ({ meta: [{ title: `${brand.name} — Configurações` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: ConfigPage,
});


function ConfigPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const userId = ctx.user.id;

  const [empresa, setEmpresa] = useState({ nome: "", telefone: "" });
  const [identidade, setIdentidade] = useState({ primary_color: "#22C55E", logo_url: "" });
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Link do Google Drive não é imagem: aquele endereço é uma PÁGINA que mostra a imagem.
  // Colado aqui, o navegador recebe HTML onde esperava um JPEG e não aparece nada. É a
  // saída natural de quem não tem onde hospedar — por isso o upload existe agora.
  const linkQueNaoFunciona = /drive\.google\.com|docs\.google\.com|dropbox\.com\/s\/|onedrive\.live\.com|1drv\.ms/i.test(identidade.logo_url);

  async function enviarLogo(file: File) {
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem (PNG, JPG ou WebP)."); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Imagem muito grande (máx. 4MB)."); return; }
    setEnviandoLogo(true);
    try {
      const ext = ((file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")) || "png";
      const caminho = `logo/${ctx.company?.id ?? "empresa"}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("campaign-media")
        // upsert:false de proposito: a politica do bucket so permite INSERT, e upsert
        // usaria PUT (update), que seria negado. O nome ja e unico pelo timestamp.
        .upload(caminho, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("campaign-media").getPublicUrl(caminho);
      setIdentidade((p) => ({ ...p, logo_url: data.publicUrl }));
      toast.success("Logo enviado! Clique em Salvar para aplicar.");
    } catch (e: any) {
      toast.error(e?.message || "Não deu para enviar a imagem.");
    } finally {
      setEnviandoLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }
  const [perfil, setPerfil] = useState({ nome: "", email: ctx.user.email ?? "" });
  const [senha, setSenha] = useState({ nova: "", confirma: "" });
  const [savingE, setSavingE] = useState(false);
  const [savingI, setSavingI] = useState(false);
  const [savingP, setSavingP] = useState(false);
  const [savingS, setSavingS] = useState(false);

  useEffect(() => {
    if (ctx.company) {
      setEmpresa({ nome: ctx.company.nome, telefone: ctx.company.telefone ?? "" });
      setIdentidade({ primary_color: ctx.company.primary_color, logo_url: ctx.company.logo_url ?? "" });
    }
    void (async () => {
      const { data } = await supabase.from("profiles").select("nome").eq("user_id", userId).maybeSingle();
      if (data) setPerfil((p) => ({ ...p, nome: data.nome ?? "" }));
    })();
  }, [companyId, userId]);

  async function saveEmpresa() {
    if (!companyId) return;
    setSavingE(true);
    const { error } = await supabase.from("company").update({ nome: empresa.nome, telefone: empresa.telefone || null }).eq("id", companyId);
    setSavingE(false);
    if (error) return toast.error(error.message);
    toast.success("Empresa atualizada"); setTimeout(() => location.reload(), 500);
  }

  async function saveIdentidade() {
    if (!companyId) return;
    setSavingI(true);
    const { error } = await supabase.from("company").update({
      primary_color: identidade.primary_color, logo_url: identidade.logo_url || null,
    }).eq("id", companyId);
    setSavingI(false);
    if (error) return toast.error(error.message);
    toast.success("Identidade atualizada"); setTimeout(() => location.reload(), 500);
  }

  async function savePerfil() {
    setSavingP(true);
    const { error } = await supabase.from("profiles").update({ nome: perfil.nome || null }).eq("user_id", userId);
    setSavingP(false);
    if (error) return toast.error(error.message);
    toast.success("Perfil atualizado");
  }

  async function saveSenha() {
    if (senha.nova.length < 8) return toast.error("Mínimo 8 caracteres");
    if (senha.nova !== senha.confirma) return toast.error("Senhas não conferem");
    setSavingS(true);
    const { error } = await supabase.auth.updateUser({ password: senha.nova });
    setSavingS(false);
    if (error) return toast.error(error.message);
    setSenha({ nova: "", confirma: "" });
    toast.success("Senha alterada");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">Configurações <HelpTip text="Dados da empresa, templates de resposta rápida, horário de atendimento, segurança, log de auditoria e exportação LGPD." /></h1>
        <p className="text-sm text-muted-foreground">Empresa, identidade e perfil.</p>
      </div>
      <Tabs defaultValue="empresa">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="identidade">Identidade</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="horarios">Horários</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
        </TabsList>

        <TabsContent value="financeiro">
          <FinanceiroTab />
        </TabsContent>


        <TabsContent value="seguranca">
          <SegurancaTab />
        </TabsContent>

        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>

        <TabsContent value="horarios">
          <HorariosTab />
        </TabsContent>



        <TabsContent value="empresa">
          <Card className="p-5 space-y-4 max-w-xl">
            <div><Label>Nome da empresa</Label><Input value={empresa.nome} onChange={(e) => setEmpresa({ ...empresa, nome: e.target.value })} /></div>
            <div><Label>Telefone</Label><Input value={empresa.telefone} onChange={(e) => setEmpresa({ ...empresa, telefone: e.target.value })} /></div>
            <div className="flex justify-end">
              <Button onClick={saveEmpresa} disabled={savingE}>
                {savingE ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />} Salvar
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="identidade">
          <Card className="p-5 space-y-4 max-w-xl">
            <div>
              <Label>Cor primária</Label>
              <div className="flex gap-2 items-center">
                <input type="color" value={identidade.primary_color} onChange={(e) => setIdentidade({ ...identidade, primary_color: e.target.value })} className="h-10 w-14 rounded border" />
                <Input value={identidade.primary_color} onChange={(e) => setIdentidade({ ...identidade, primary_color: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Logo
                <HelpTip text="Escolha um arquivo do seu computador. Link do Google Drive ou Dropbox não funciona: esses endereços são páginas, não o arquivo da imagem." />
              </Label>
              <div className="flex items-start gap-3">
                <div className="size-20 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--panel-2)] grid place-items-center overflow-hidden shrink-0">
                  {identidade.logo_url ? (
                    <img
                      src={identidade.logo_url}
                      alt="logo"
                      className="size-full object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <span className="text-[10.5px] text-muted-foreground text-center px-1">sem logo</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarLogo(f); }}
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={enviandoLogo} onClick={() => logoInputRef.current?.click()}>
                      {enviandoLogo ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Upload className="size-4 mr-1.5" />}
                      {identidade.logo_url ? "Trocar imagem" : "Escolher imagem"}
                    </Button>
                    {identidade.logo_url && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setIdentidade({ ...identidade, logo_url: "" })}>
                        <Trash2 className="size-4 mr-1.5" /> Remover
                      </Button>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">PNG, JPG, WebP ou SVG · até 4MB</p>
                </div>
              </div>

              <details className="text-[12px]">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">ou colar um endereço</summary>
                <Input
                  className="mt-2"
                  value={identidade.logo_url}
                  onChange={(e) => setIdentidade({ ...identidade, logo_url: e.target.value })}
                  placeholder="https://…"
                />
              </details>

              {linkQueNaoFunciona && (
                <p className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  <span>
                    Esse link é de uma página do Drive/Dropbox, não do arquivo — a imagem não vai aparecer.
                    Use o botão <strong>Escolher imagem</strong> acima.
                  </span>
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={saveIdentidade} disabled={savingI}>
                {savingI ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />} Salvar
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="perfil">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold">Meus dados</h2>
              <div><Label>Email</Label><Input value={perfil.email} disabled /></div>
              <div><Label>Nome</Label><Input value={perfil.nome} onChange={(e) => setPerfil({ ...perfil, nome: e.target.value })} /></div>
              <div className="flex justify-end">
                <Button onClick={savePerfil} disabled={savingP}>
                  {savingP ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />} Salvar
                </Button>
              </div>
            </Card>
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold">Trocar senha</h2>
              <div><Label>Nova senha</Label><Input type="password" value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} /></div>
              <div><Label>Confirmar</Label><Input type="password" value={senha.confirma} onChange={(e) => setSenha({ ...senha, confirma: e.target.value })} /></div>
              <div className="flex justify-end">
                <Button onClick={saveSenha} disabled={savingS}>
                  {savingS ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />} Trocar
                </Button>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SegurancaTab() {
  const fetchLog = useServerFn(listAuditLog);
  const fetchExport = useServerFn(exportLgpd);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState<boolean>(
    typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted"
  );

  useEffect(() => {
    void (async () => {
      try { setRows(await fetchLog()); } catch (e: any) { toast.error(e?.message ?? "Erro"); }
      finally { setLoading(false); }
    })();
  }, []);

  async function pedirNotificacoes() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return toast.error("Seu navegador não suporta notificações.");
    }
    const p = await Notification.requestPermission();
    setNotifEnabled(p === "granted");
    if (p === "granted") toast.success("Notificações ativadas");
  }

  async function baixarExport() {
    setExporting(true);
    try {
      const data = await fetchExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `lgpd-export-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("Exportação concluída");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao exportar");
    } finally { setExporting(false); }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Sparkles className="size-4" /> Notificações do navegador</h2>
            <p className="text-sm text-muted-foreground">Receba um aviso quando chegar nova mensagem na tela de Conversas.</p>
          </div>
          <Button variant={notifEnabled ? "secondary" : "default"} onClick={pedirNotificacoes} disabled={notifEnabled}>
            {notifEnabled ? "Ativadas" : "Ativar"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Download className="size-4" /> Exportação LGPD</h2>
            <p className="text-sm text-muted-foreground">Baixe um JSON com todos os dados da sua empresa armazenados aqui.</p>
          </div>
          <Button onClick={baixarExport} disabled={exporting}>
            {exporting ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Download className="size-4 mr-1.5" />} Exportar
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Shield className="size-4" /> Log de auditoria</h2>
        <p className="text-sm text-muted-foreground">Últimas 200 ações registradas.</p>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</div>
        ) : (
          <div className="border rounded-md divide-y max-h-[500px] overflow-auto">
            {rows.map((r) => (
              <div key={r.id} className="p-3 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.acao}{r.recurso ? ` · ${r.recurso}` : ""}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.actor_email ?? "sistema"}</div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FinanceiroTab() {
  const fetchStatus = useServerFn(finStatus);
  const toggle = useServerFn(enableFinanceiro);
  const [st, setSt] = useState<{ ativo: boolean; planoPermite: boolean; diasVencimento: number; planSlug: string } | null>(null);
  const [dias, setDias] = useState(7);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const s = await fetchStatus();
      setSt(s);
      setDias(s.diasVencimento);
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  }
  useEffect(() => { void load(); }, []);

  async function setEnabled(v: boolean) {
    setSaving(true);
    try {
      await toggle({ data: { enable: v, diasVencimentoPadrao: dias } });
      toast.success(v ? "Módulo ativado" : "Módulo desativado");
      void load();
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    finally { setSaving(false); }
  }

  async function saveDias() {
    if (!st?.ativo) return;
    setSaving(true);
    try {
      await toggle({ data: { enable: true, diasVencimentoPadrao: dias } });
      toast.success("Configuração salva");
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    finally { setSaving(false); }
  }

  if (!st) return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Carregando…</div>;

  if (!st.planoPermite) {
    return (
      <Card className="p-6 max-w-2xl space-y-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-muted grid place-items-center"><Lock className="size-5" /></div>
          <div>
            <h2 className="font-semibold">Módulo Financeiro</h2>
            <p className="text-sm text-muted-foreground">Não foi possível liberar o módulo agora. Recarregue a página.</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-[color:var(--brand-soft)] grid place-items-center">
          <Wallet className="size-5 text-[color:var(--brand-text)]" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold flex items-center gap-2">
            Módulo Financeiro
            <Badge variant={st.ativo ? "default" : "secondary"}>{st.ativo ? "Ativado" : "Desativado"}</Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            Se você já usa outro sistema financeiro, deixe desativado — o menu somem e nada interfere no atendimento.
          </p>
        </div>
        <Button variant={st.ativo ? "outline" : "default"} onClick={() => setEnabled(!st.ativo)} disabled={saving}>
          {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
          {st.ativo ? "Desativar" : "Ativar"}
        </Button>
      </div>

      {st.ativo && (
        <div className="border-t pt-4 space-y-2">
          <Label>Vencimento padrão para receitas geradas pelo CRM</Label>
          <div className="flex items-center gap-2 max-w-xs">
            <Input type="number" min={0} max={60} value={dias} onChange={(e) => setDias(Number(e.target.value))} />
            <span className="text-sm text-muted-foreground whitespace-nowrap">dias após o ganho</span>
          </div>
          <p className="text-xs text-muted-foreground">Quando um lead for movido para Ganho no CRM, uma receita pendente é criada com essa data de vencimento.</p>
          <div className="flex justify-end">
            <Button onClick={saveDias} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />} Salvar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

