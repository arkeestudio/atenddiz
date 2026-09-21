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
 * Apaga tudo o que o sistema sabe sobre UM contato, para testar a IA do zero.
 *
 * Sem isso, cada teste de tom carrega o histórico e a ficha do teste anterior — a IA
 * responde diferente porque já "conhece" a pessoa, e nunca dá para ver como ela recebe
 * um lead novo de verdade. Depois de reiniciar, a próxima mensagem daquele número entra
 * como primeiro contato.
 *
 * Apaga: mensagens, card do CRM (leva junto ficha, notas e eventos por cascade),
 * pausa de atendimento humano e as imagens que o contato mandou.
 * Não toca na configuração da IA nem em nenhum outro contato.
 */
export const reiniciarConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const numero = String(data.numero || "").trim();
    if (!numero) throw new Error("Número não informado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { extrairCaminhoMidia } = await import("./midia-conversa.shared");

    // Recolhe as imagens antes de apagar as mensagens, senão o caminho se perde e os
    // arquivos ficam órfãos no bucket a cada rodada de teste.
    const { data: msgs } = await (supabaseAdmin as any)
      .from("mensagens")
      .select("texto")
      .eq("company_id", companyId)
      .eq("numero", numero);
    const arquivos = ((msgs ?? []) as any[])
      .map((m) => extrairCaminhoMidia(String(m.texto ?? "")))
      .filter((c): c is string => !!c);

    const apagadas = (msgs ?? []).length;

    await (supabaseAdmin as any).from("mensagens").delete().eq("company_id", companyId).eq("numero", numero);
    await (supabaseAdmin as any).from("contact_pause").delete().eq("company_id", companyId).eq("numero", numero);
    // O card leva ficha, notas e eventos junto (ON DELETE CASCADE).
    await (supabaseAdmin as any).from("crm_cards").delete().eq("company_id", companyId).eq("numero", numero);

    if (arquivos.length) {
      try {
        const { BUCKET_MIDIA } = await import("./midia-conversa.server");
        await (supabaseAdmin as any).storage.from(BUCKET_MIDIA).remove(arquivos);
      } catch (e: any) {
        // Arquivo órfão é chato, não é erro: a conversa já foi reiniciada.
        console.warn("[reiniciarConversa] não deu para apagar a mídia:", e?.message);
      }
    }

    return { ok: true, mensagens: apagadas, arquivos: arquivos.length };
  });
