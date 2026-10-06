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

// Linha da agenda com o contato, limitada à empresa de quem pede.
async function carregarVisita(admin: any, companyId: string, id: string) {
  const { data } = await admin
    .from("agendamento")
    .select("id, titulo, inicio, fim, status, google_event_id, card_id, crm_cards(numero, nome, nome_whatsapp, ficha)")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error("Visita não encontrada.");
  return data as any;
}

// Ficha e card do contato acompanham a visita: data na ficha, próxima ação e follow-up.
async function refletirNoContato(admin: any, companyId: string, row: any, userId: string, patch: { quando: string | null; titulo: string; followUp: string | null; nota: string; evento: string; tipo: string }) {
  if (!row.card_id) return;
  const ficha = row.crm_cards?.ficha && typeof row.crm_cards.ficha === "object" ? row.crm_cards.ficha : {};
  const chaveVisita = Object.keys(ficha).find((k) => /visita/i.test(k)) || "visita";
  await admin
    .from("crm_cards")
    .update({
      ficha: { ...ficha, [chaveVisita]: patch.quando ?? "" },
      proxima_acao: patch.quando ? `${patch.titulo} — ${patch.quando}` : null,
      follow_up: patch.followUp,
    })
    .eq("id", row.card_id);
  await admin.from("lead_evento").insert({ company_id: companyId, card_id: row.card_id, tipo: patch.tipo, descricao: patch.evento });
  if (row.crm_cards?.numero) {
    await admin.from("mensagens").insert({
      company_id: companyId, user_id: userId, numero: row.crm_cards.numero,
      direcao: "saida", autor: "sistema", texto: `🔒 [NOTA INTERNA]: ${patch.nota}`,
    });
  }
}

/** Remarca ou renomeia uma visita. Confere conflito (ignorando a própria), sincroniza Google, ficha e card. */
export const editarAgendamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; inicio: string; fim: string; titulo: string; ignorarConflito?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { validarAgendamento, conflita, descreverHorario } = await import("./agenda.server");

    const row = await carregarVisita(admin, companyId, data.id);
    const titulo = String(data.titulo || "").trim().slice(0, 120) || row.titulo || "Visita";
    const v = validarAgendamento({ inicio: data.inicio, fim: data.fim, titulo });
    if (!v.ok) throw new Error(`Não dá para remarcar: ${v.motivo}.`);

    const { data: gi } = await admin.from("google_integration").select("conectado").eq("company_id", companyId).maybeSingle();
    const googleConectado = !!gi?.conectado;

    if (!data.ignorarConflito) {
      const { data: outras } = await admin
        .from("agendamento")
        .select("inicio, fim")
        .eq("company_id", companyId)
        .neq("id", row.id)
        .neq("status", "cancelado")
        .lt("inicio", v.fim.toISOString())
        .gt("fim", v.inicio.toISOString());
      let ocupados: Array<{ inicio: string; fim: string }> = (outras ?? []) as any[];
      if (googleConectado) {
        try {
          const { listarOcupados } = await import("./google.server");
          const antigoIni = +new Date(row.inicio), antigoFim = +new Date(row.fim);
          // O próprio evento aparece como ocupado no Google: tira o intervalo antigo da conta.
          const doGoogle = (await listarOcupados(admin, companyId, v.inicio.toISOString(), v.fim.toISOString()))
            .filter((o) => Math.abs(+new Date(o.inicio) - antigoIni) > 60_000 || Math.abs(+new Date(o.fim) - antigoFim) > 60_000);
          ocupados = [...ocupados, ...doGoogle];
        } catch (e: any) {
          console.warn("[editarAgendamento] Google indisponível para checar conflito:", e?.message);
        }
      }
      if (conflita(ocupados, v.inicio, v.fim)) {
        return { ok: false as const, conflito: true as const, quando: descreverHorario(v.inicio) };
      }
    }

    const antes = descreverHorario(new Date(row.inicio));
    const quando = descreverHorario(v.inicio);
    const { error } = await admin
      .from("agendamento")
      .update({ titulo, inicio: v.inicio.toISOString(), fim: v.fim.toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(error.message);

    let google: "ok" | "falhou" | "nao" = "nao";
    if (row.google_event_id && googleConectado) {
      try {
        const { atualizarEventoGoogle } = await import("./google.server");
        await atualizarEventoGoogle(admin, companyId, row.google_event_id, { titulo, inicio: v.inicio.toISOString(), fim: v.fim.toISOString() });
        google = "ok";
      } catch (e: any) {
        console.warn("[editarAgendamento] Google não atualizou:", e?.message);
        google = "falhou";
      }
    }

    await refletirNoContato(admin, companyId, row, context.userId, {
      quando, titulo, followUp: v.inicio.toISOString(), tipo: "agendamento",
      evento: `Visita remarcada pela equipe: de ${antes} para ${quando}`,
      nota: `📝 Visita remarcada pela equipe: de ${antes} para ${quando} (${titulo}).${google === "falhou" ? " O Google Agenda não atualizou — confira lá." : ""}`,
    });

    return { ok: true as const, conflito: false as const, quando, google };
  });

/** Remove a visita de vez (diferente de cancelar, que mantém o registro). Sincroniza Google, ficha e card. */
export const excluirAgendamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { descreverHorario } = await import("./agenda.server");

    const row = await carregarVisita(admin, companyId, data.id);
    const quando = descreverHorario(new Date(row.inicio));

    let google: "ok" | "falhou" | "nao" = "nao";
    if (row.google_event_id) {
      try {
        const { excluirEventoGoogle } = await import("./google.server");
        await excluirEventoGoogle(admin, companyId, row.google_event_id);
        google = "ok";
      } catch (e: any) {
        console.warn("[excluirAgendamento] Google não removeu:", e?.message);
        google = "falhou";
      }
    }

    const { error } = await admin.from("agendamento").delete().eq("id", row.id).eq("company_id", companyId);
    if (error) throw new Error(error.message);

    await refletirNoContato(admin, companyId, row, context.userId, {
      quando: null, titulo: row.titulo, followUp: null, tipo: "agendamento",
      evento: `Visita de ${quando} excluída pela equipe`,
      nota: `🗑 Visita de ${quando} (${row.titulo}) excluída pela equipe.${google === "falhou" ? " O Google Agenda não removeu — confira lá." : ""}`,
    });

    return { ok: true as const, quando, google };
  });
