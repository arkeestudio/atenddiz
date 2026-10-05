import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("company_user")
    .select("company_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Você ainda não possui uma empresa.");
  return data.company_id as string;
}

/**
 * Visita marcada pela equipe (não pela IA). Entra na mesma tabela, então a IA passa a ver
 * o horário como ocupado e a equipe vê tudo num lugar só. Se houver contato ligado, a data
 * vai para a ficha dele — é assim que a IA fica sabendo que aquela família já tem visita.
 *
 * Conflito não bloqueia: avisa, e a tela pergunta "marcar mesmo assim?". Quem está na
 * recepção sabe quando duas visitas no mesmo horário são intencionais.
 */
export const criarAgendamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inicio: string; fim: string; titulo: string; numero?: string | null; ignorarConflito?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { validarAgendamento, conflita, ocupadosLocais, descreverHorario } = await import("./agenda.server");

    const titulo = String(data.titulo || "").trim().slice(0, 120) || "Visita";
    const v = validarAgendamento({ inicio: data.inicio, fim: data.fim, titulo });
    if (!v.ok) throw new Error(`Não dá para marcar: ${v.motivo}.`);

    const { data: gi } = await admin.from("google_integration").select("conectado").eq("company_id", companyId).maybeSingle();
    const googleConectado = !!gi?.conectado;

    if (!data.ignorarConflito) {
      const locais = await ocupadosLocais(admin, companyId, v.inicio.toISOString(), v.fim.toISOString());
      let ocupados = locais;
      if (googleConectado) {
        try {
          const { listarOcupados } = await import("./google.server");
          ocupados = [...locais, ...(await listarOcupados(admin, companyId, v.inicio.toISOString(), v.fim.toISOString()))];
        } catch (e: any) {
          console.warn("[criarAgendamento] Google indisponível para checar conflito:", e?.message);
        }
      }
      if (conflita(ocupados, v.inicio, v.fim)) {
        return { ok: false as const, conflito: true as const, quando: descreverHorario(v.inicio) };
      }
    }

    const numero = String(data.numero || "").replace(/\D/g, "") || null;
    let card: { id: string; ficha: any; nome: string | null } | null = null;
    if (numero) {
      const { data: c } = await admin.from("crm_cards").select("id, ficha, nome").eq("company_id", companyId).eq("numero", numero).maybeSingle();
      card = c ?? null;
    }

    if (googleConectado) {
      const { createCalendarEventForCompany } = await import("./google.server");
      await createCalendarEventForCompany(admin, companyId, {
        titulo,
        inicio: v.inicio.toISOString(),
        fim: v.fim.toISOString(),
        descricao: `Marcada pela equipe${card?.nome ? ` — ${card.nome}` : ""}`,
        cardId: card?.id ?? null,
      });
    } else {
      const { error } = await admin.from("agendamento").insert({
        company_id: companyId,
        card_id: card?.id ?? null,
        titulo,
        inicio: v.inicio.toISOString(),
        fim: v.fim.toISOString(),
        status: "agendado",
      });
      if (error) throw new Error(error.message);
    }

    const quando = descreverHorario(v.inicio);
    if (card) {
      // Ficha: a IA lê e não oferece visita de novo; card: próxima ação visível no Kanban.
      const ficha = card.ficha && typeof card.ficha === "object" ? card.ficha : {};
      const chaveVisita = Object.keys(ficha).find((k) => /visita/i.test(k)) || "visita";
      await admin
        .from("crm_cards")
        .update({ ficha: { ...ficha, [chaveVisita]: quando }, proxima_acao: `${titulo} — ${quando}`, follow_up: v.inicio.toISOString() })
        .eq("id", card.id);
      await admin.from("lead_evento").insert({
        company_id: companyId, card_id: card.id, tipo: "agendamento",
        descricao: `Visita marcada pela equipe: ${quando} (${titulo})`,
      });
      if (numero) {
        await admin.from("mensagens").insert({
          company_id: companyId, user_id: context.userId, numero,
          direcao: "saida", autor: "sistema",
          texto: `🔒 [NOTA INTERNA]: 📅 Visita marcada pela equipe — ${quando} (${titulo}).`,
        });
      }
    }

    return { ok: true as const, conflito: false as const, quando, google: googleConectado };
  });
