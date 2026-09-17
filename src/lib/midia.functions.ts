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
 * Devolve URLs temporárias para exibir imagens da conversa.
 * O bucket é privado: só a chave de serviço lê, e o caminho precisa começar pelo
 * company_id de quem está pedindo — assim uma empresa não enxerga a mídia de outra.
 */
export const assinarMidiasConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caminhos: string[] }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { assinarMidia } = await import("./midia-conversa.server");

    const caminhos = (data.caminhos ?? []).slice(0, 60).filter((c) => typeof c === "string" && c.startsWith(`${companyId}/`));
    const urls: Record<string, string> = {};
    await Promise.all(
      caminhos.map(async (c) => {
        const url = await assinarMidia(c, 3600);
        if (url) urls[c] = url;
      }),
    );
    return { urls };
  });
