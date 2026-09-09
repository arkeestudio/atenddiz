import { createFileRoute } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, RefreshCw, Power, QrCode, Flame } from "lucide-react";
import { brand } from "@/config/brand";
import { connectWhatsapp, checkWhatsappStatus, disconnectWhatsapp, getWhatsappSettings, setWhatsappWarmup } from "@/lib/evolution.functions";
import { usePlanFeatures } from "@/hooks/use-plan-features";
import { PlanUsageBadge } from "@/components/plan-usage-badge";

export const Route = createFileRoute("/app/conexao")({
  head: () => ({ meta: [{ title: `${brand.name} — Conexão` }] }),
  component: ConexaoPage,
});

function ConexaoPage() {
  const connect = useServerFn(connectWhatsapp);
  const check = useServerFn(checkWhatsappStatus);
  const disconnect = useServerFn(disconnectWhatsapp);
  const getSettings = useServerFn(getWhatsappSettings);
  const saveWarmup = useServerFn(setWhatsappWarmup);
  const plan = usePlanFeatures();

  const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("disconnected");
  const [numero, setNumero] = useState<string | null>(null);
  const [warmup, setWarmup] = useState<{ ativo: boolean; limite: number }>({ ativo: false, limite: 50 });
  const [savingWarmup, setSavingWarmup] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void doCheck();
    void getSettings()
      .then((s: any) => setWarmup({ ativo: !!s.aquecimento_ativo, limite: s.aquecimento_limite_dia ?? 50 }))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleSaveWarmup() {
    setSavingWarmup(true);
    try {
      await saveWarmup({ data: { ativo: warmup.ativo, limite: warmup.limite } });
      toast.success("Configuração de aquecimento salva!");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar aquecimento");
    } finally {
      setSavingWarmup(false);
    }
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { void doCheck(true); }, 5000);
  }
  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function doCheck(silent = false) {
    try {
      const r: any = await check();
      setStatus(r.status);
      setNumero(r.numero ?? null);
      if (r.qrBase64 && r.status !== "connected") {
        setQr(r.qrBase64);
        if (!pollRef.current) startPolling();
      }
      if (r.status === "connected") { setQr(null); stopPolling(); if (!silent) toast.success("WhatsApp conectado!"); }
    } catch (e: any) { if (!silent) toast.error(e?.message || "Erro ao consultar status"); }
  }

  async function doConnect(force = false) {
    setLoading(true); setQr(null);
    try {
      const r = await connect({ data: { force } });
      setQr(r.qrBase64 ?? null);
      setStatus(r.state === "open" ? "connected" : "connecting");
      if (r.state === "open") toast.success("Já está conectado!");
      else if (r.qrBase64) { toast.message("QR Code gerado. Escaneie no WhatsApp."); startPolling(); }
      else { toast.message("Instância criada. Buscando QR…"); startPolling(); }
    } catch (e: any) { toast.error(e?.message || "Falha ao conectar"); }
    finally { setLoading(false); }
  }

  async function doSwitchNumber() {
    const ok = window.confirm(
      "Isso desconecta o número atual e gera um QR Code novo para pareá-lo com outro celular. Continuar?",
    );
    if (!ok) return;
    setNumero(null);
    await doConnect(true);
  }

  async function doDisconnect() {
    setLoading(true);
    try {
      await disconnect();
      setStatus("disconnected"); setNumero(null); setQr(null); stopPolling();
      toast.success("Desconectado");
    } catch (e: any) { toast.error(e?.message || "Falha ao desconectar"); }
    finally { setLoading(false); }
  }

  const statusBadge =
    status === "connected" ? <Badge className="bg-primary">Conectado</Badge>
    : status === "connecting" ? <Badge variant="secondary" className="bg-amber-500/15 text-amber-700">Conectando…</Badge>
    : <Badge variant="outline">Desconectado</Badge>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">Conexão WhatsApp <HelpTip text="Pareie seu número escaneando o QR Code no celular. Depois disso, o agente passa a responder automaticamente as mensagens recebidas." /></h1>
          <p className="text-sm text-muted-foreground">Conecte sua linha via OpenWA (WhatsApp Automate).</p>
        </div>
        {!plan.loading && (
          <PlanUsageBadge label="números" used={plan.usage.instancias} limit={plan.limites.instancias} />
        )}
      </div>


      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm text-muted-foreground">Status</div>
            <div className="flex items-center gap-3 mt-1">
              {statusBadge}
              {numero && <span className="text-sm text-muted-foreground">· {numero}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => doCheck()} disabled={loading}>
              <RefreshCw className="size-4 mr-1.5" /> Atualizar
            </Button>
            {status === "connected" ? (
              <>
                <Button variant="outline" size="sm" onClick={doSwitchNumber} disabled={loading}>
                  {loading ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <QrCode className="size-4 mr-1.5" />}
                  Trocar número
                </Button>
                <Button variant="destructive" size="sm" onClick={doDisconnect} disabled={loading}>
                  <Power className="size-4 mr-1.5" /> Desconectar
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => doConnect(!!qr)} disabled={loading}>
                {loading ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <QrCode className="size-4 mr-1.5" />}
                {qr ? "Gerar novo QR" : "Conectar WhatsApp"}
              </Button>
            )}
          </div>
        </div>

        {qr ? (
          <div className="grid md:grid-cols-2 gap-6 items-center">
            <div className="bg-white p-4 rounded-xl border border-border w-fit mx-auto shadow-sm">
              <img src={qr} alt="QR Code WhatsApp" className="size-72 object-contain" />
            </div>
            <div className="space-y-3 text-sm">
              <h3 className="font-semibold text-base">Como escanear</h3>
              <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
                <li>Abra o WhatsApp no celular.</li>
                <li>Toque em <b>Aparelhos conectados</b>.</li>
                <li>Toque em <b>Conectar um aparelho</b>.</li>
                <li>Aponte a câmera para este QR Code.</li>
              </ol>
              <p className="text-xs text-muted-foreground">Sincronizando a cada 5 segundos...</p>
            </div>
          </div>
        ) : status === "connected" ? (
          <div className="text-sm text-muted-foreground">Tudo certo! As mensagens serão respondidas automaticamente.</div>
        ) : status === "connecting" ? (
          <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span>Iniciando sessão do WhatsApp e gerando QR Code... Aguarde alguns segundos.</span>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Clique em <b>Conectar WhatsApp</b> para gerar o QR Code.</div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <Flame className="size-5 text-orange-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  Modo aquecimento
                  <HelpTip text="Limita quantas mensagens de campanha este número dispara por dia (últimas 24h). Essencial para números novos: reduz o risco de bloqueio pela Meta. Comece baixo e aumente aos poucos conforme o número 'esquenta'." />
                </h2>
                <p className="text-sm text-muted-foreground">Protege números novos limitando os envios diários de campanha.</p>
              </div>
              <Switch checked={warmup.ativo} onCheckedChange={(v) => setWarmup((w) => ({ ...w, ativo: v }))} />
            </div>
            {warmup.ativo && (
              <div className="mt-4">
                <Label>Limite de envios por dia</Label>
                <Input type="number" min={1} max={1000} value={warmup.limite} className="w-32 mt-1"
                  onChange={(e) => setWarmup((w) => ({ ...w, limite: Number(e.target.value) }))} />
                <p className="text-xs text-muted-foreground mt-1">Sugestão: número novo comece com ~20-30/dia e vá subindo.</p>
              </div>
            )}
            <Button size="sm" className="mt-4" disabled={savingWarmup} onClick={handleSaveWarmup}>
              {savingWarmup ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null} Salvar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
