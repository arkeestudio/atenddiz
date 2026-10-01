import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supportWhatsappUrl, supportWhatsappDisplay } from "@/config/brand";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Precisa de ajuda?{" "}
          <a href={supportWhatsappUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
            Falar com suporte ({supportWhatsappDisplay})
          </a>
        </p>
      </div>
    </div>
  );
}

// A partir do router 1.170 o erro chega como `unknown` (pode ser string, objeto, qualquer
// coisa lançada). Normaliza para Error para o relatório e o console continuarem iguais.
function ErrorComponent({ error: bruto, reset }: { error: unknown; reset: () => void }) {
  const error = bruto instanceof Error ? bruto : new Error(typeof bruto === "string" ? bruto : JSON.stringify(bruto));
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Precisa de ajuda?{" "}
          <a href={supportWhatsappUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
            Falar com suporte ({supportWhatsappDisplay})
          </a>
        </p>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Atendizz — Atendente de WhatsApp com IA + CRM Kanban" },
      { name: "description", content: "Conecte o WhatsApp, deixe a IA atender e organize seus leads em um kanban arrastável." },
      { name: "author", content: "Atendizz" },
      { property: "og:title", content: "Atendizz — Atendente de WhatsApp com IA + CRM Kanban" },
      { property: "og:description", content: "Conecte o WhatsApp, deixe a IA atender e organize seus leads em um kanban arrastável." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Atendizz — Atendente de WhatsApp com IA + CRM Kanban" },
      { name: "twitter:description", content: "Conecte o WhatsApp, deixe a IA atender e organize seus leads em um kanban arrastável." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/063e785c-e670-4910-86a1-b0bb141f6a96/id-preview-36807bb7--be429179-e739-4302-b8f8-67595d55c75d.lovable.app-1781545525627.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/063e785c-e670-4910-86a1-b0bb141f6a96/id-preview-36807bb7--be429179-e739-4302-b8f8-67595d55c75d.lovable.app-1781545525627.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const NO_FLASH_THEME = `(()=>{try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'){d.classList.add('dark')}else{d.classList.remove('dark')}}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>

      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
