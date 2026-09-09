import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data: member } = await supabase
    .from("company_user")
    .select("company_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  if (!member?.company_id) throw new Error("Empresa não encontrada para o usuário");
  return member.company_id as string;
}

export const markConversationSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name, status")
      .eq("company_id", companyId)
      .maybeSingle();

    if (inst?.instance_name && provider.sendSeen) {
      try {
        await provider.sendSeen(companyId, inst.instance_name, data.numero);
      } catch (e: any) {
        console.warn("[openwa.sendSeen]", e?.message);
      }
    }

    return { ok: true };
  });

export const sendTypingPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; presence: "composing" | "paused" }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name, status")
      .eq("company_id", companyId)
      .maybeSingle();

    if (inst?.instance_name && provider.sendPresence) {
      try {
        await provider.sendPresence(companyId, inst.instance_name, data.numero, data.presence, 2500);
      } catch {}
    }

    return { ok: true };
  });

export const fetchContactProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name, status")
      .eq("company_id", companyId)
      .maybeSingle();

    if (inst?.instance_name && provider.getProfile) {
      try {
        const profile = await provider.getProfile(companyId, inst.instance_name, data.numero);
        if (profile?.name) {
          await supabase
            .from("crm_cards")
            .update({ nome: profile.name })
            .eq("company_id", companyId)
            .eq("numero", data.numero)
            .is("nome", null);
        }
        return profile;
      } catch (e: any) {
        console.warn("[openwa.getProfile]", e?.message);
      }
    }

    return { profilePicUrl: null, name: null, about: null };
  });
