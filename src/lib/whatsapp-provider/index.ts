import type { IWhatsAppProvider } from "./whatsapp-provider.interface";
import { EvolutionAdapter } from "./evolution.adapter";
import { OpenWAAdapter } from "./openwa.adapter";

export * from "./whatsapp-provider.interface";
export * from "./evolution.adapter";
export * from "./openwa.adapter";
export * from "./openwa.server";

export function getWhatsAppProvider(requestedProvider?: string): IWhatsAppProvider {
  const provider = (
    requestedProvider ||
    process.env.WHATSAPP_PROVIDER ||
    "openwa"
  ).toLowerCase().trim();

  if (provider === "evolution") {
    return new EvolutionAdapter();
  }

  return new OpenWAAdapter();
}
