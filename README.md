# Atenddiz

Plataforma de Atendimento Comercial Inteligente, CRM Kanban e Agente IA 24/7 no WhatsApp.

[![Licença](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node->=20.0.0-blue.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/react-19-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/vite-7-purple.svg)](https://vitejs.dev/)
[![WhatsApp Gateway](https://img.shields.io/badge/whatsapp-OpenWA-brightgreen.svg)](https://github.com/open-wa/wa-automate-nodejs)
[![Supabase](https://img.shields.io/badge/database-Supabase-emerald.svg)](https://supabase.com/)
[![Gemini](https://img.shields.io/badge/AI-Google_Gemini_2.5-orange.svg)](https://deepmind.google/technologies/gemini/)

Transforme seu WhatsApp em uma máquina de vendas e atendimento automatizado com inteligência artificial generativa, pipeline CRM Kanban interativo e transbordo humano inteligente.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Principais Funcionalidades](#principais-funcionalidades)
- [Arquitetura do Sistema](#arquitetura-do-sistema)
- [Stack Tecnológica](#stack-tecnológica)
- [Estrutura do Repositório](#estrutura-do-repositório)
- [Guia de Instalação e Execução Local](#guia-de-instalação-e-execução-local)
- [Configuração de Variáveis de Ambiente](#configuração-de-variáveis-de-ambiente)
- [Produção](#produção)
- [Solução de Problemas Frequentes](#solução-de-problemas-frequentes)
- [Licença e Direitos](#licença-e-direitos)

---

## Visão Geral

O **Atenddiz** é uma solução fullstack criada para empresas que desejam automatizar conversas no WhatsApp sem perder a humanização e a eficiência comercial.

Diferente de chatbots baseados em fluxos rígidos com menus numéricos, o Atenddiz utiliza **modelos de linguagem avançados (Google Gemini 2.5 Flash Lite)** integrados ao contexto em tempo real do negócio, catálogo de produtos, tabela de preços, horários de funcionamento e regras de negócio personalizáveis.

---

## Principais Funcionalidades

### 1. Agente IA com Modos Especializados

- **Modo Vendedor Ativo (Foco em Conversão):** Conduz o lead de forma persuasiva pelo funil de vendas, descobre dores e necessidades, apresenta produtos do catálogo e gera cobrança PIX imediata (com código Copia e Cola automático e QR code dinâmico).
- **Modo Assistente Receptivo (Foco em Suporte):** Tira dúvidas frequentes, orienta sobre políticas e horários de atendimento, priorizando acolhimento antes de encaminhar para a equipe.
- **Divisão Inteligente em Bolhas:** Opção de envio fragmentado (1 a 3 bolhas de mensagem) com pausas naturais, simulando uma conversa humana realista.
- **Pausa Automática por Intervenção Humana:** A IA pausa instantaneamente suas respostas quando um atendente assume a conversa pelo painel ou pelo WhatsApp.

### 2. Encaminhamento e Transbordo com Resumo Executivo (Briefing IA)

- **Briefing Executivo Automático:** Quando o cliente solicita atendimento humano ou fecha negócio, a IA compila em segundos um relatório estruturado:
  - Perfil e interesse do lead;
  - Pontos negociados e objeções identificadas;
  - Link direto (`wa.me`) para o atendente assumir a conversa com 1 clique.
- **Disparo no WhatsApp da Equipe:** O resumo é encaminhado diretamente para o número configurado do atendente ou supervisor.

### 3. CRM Kanban Multietapas em Tempo Real

- Visualização completa do pipeline de vendas (*Novos Leads, Em Atendimento, Aguardando Pagamento, Concluídos, Perdidos*).
- Arraste e solte de cartões (*Drag and Drop*) alimentado por `@dnd-kit`.
- Gaveta lateral (*Lead Drawer*) com histórico detalhado das conversas, campos personalizados, anotações internas e transbordo manual.

### 4. Painel de Conversas Unificado (Inbox Web)

- Interface idêntica ao WhatsApp Web moderna com suporte a temas.
- Visualização de mensagens de texto, notas de voz (com transcrição via IA), imagens e comprovantes de pagamento.
- **Copilot de Atendimento:** Botões para resumir a conversa com 1 clique e sugerir respostas personalizadas.

### 5. WhatsApp Gateway Nativo (OpenWA Server)

- Servidor WhatsApp Web nativo e independente via Puppeteer (`openwa-server/`), com autenticação por chave de API.
- Suporte nativo ao protocolo WhatsApp Multi-Device (MD), mapeando automaticamente IDs locais (`@lid`) para números telefônicos reais (`@c.us`).
- Roda em uma VM própria com PM2 e restaura as sessões sozinho após reinícios.
- Bypass automático de restrições de envio, permitindo comunicação fluida com novos contatos.

---

## Arquitetura do Sistema

```mermaid
flowchart TD
    Cliente([Cliente no WhatsApp]) <-->|Mensagens WhatsApp| WA[WhatsApp Multi-Device / Web]
    WA <-->|Puppeteer / WebSocket| OpenWA[OpenWA Server - VM\nopenwa-server/]
    OpenWA -->|Webhook HTTP POST| WebhookRoute[Atenddiz Webhook\n/api/public/whatsapp-webhook]
    
    subgraph Atenddiz Engine [Vercel]
        WebhookRoute --> PromptEngine[AI Prompt Builder & Handover]
        PromptEngine <--> GeminiAPI[Google Gemini 2.5 Flash Lite]
        PromptEngine --> Database[(Supabase PostgreSQL)]
        CRM[Painel CRM Kanban & Conversas] <--> Database
    end
    
    WebhookRoute -->|Envia resposta IA| OpenWA
    PromptEngine -->|Transbordo com Briefing| OpenWA
    OpenWA -->|Encaminha Resumo| Atendente([WhatsApp do Atendente])
```

---

## Stack Tecnológica

| Camada | Tecnologia | Descrição |
| --- | --- | --- |
| **Frontend** | React 19, TanStack Router, TanStack Start | SPA/SSR moderno com roteamento type-safe |
| **Estilização** | Tailwind CSS v4, Radix UI, Lucide Icons | Design system moderno, responsivo e dark/light mode |
| **Backend** | TanStack Start Server Functions, Node.js | Rotas de API e funções server-side integradas |
| **Banco de Dados** | Supabase (PostgreSQL 15+) | Autenticação, Row Level Security (RLS) e Realtime |
| **WhatsApp Engine** | Node.js + `@open-wa/wa-automate` | Gateway WhatsApp na porta 2785 com Puppeteer headless |
| **Inteligência Artificial** | Google Gemini, Anthropic Claude, OpenAI | Geração de respostas, briefing de leads e transcrição de áudio |
| **Hospedagem** | Vercel (app) + VM com PM2 (`openwa-server/`) | App serverless e gateway WhatsApp em processo contínuo |

---

## Estrutura do Repositório

```text
Atenddiz/
├── openwa-server/                  # Gateway WhatsApp (instalação própria, roda na VM)
│   ├── openwa_server.mjs           # API OpenWA (porta 2785)
│   ├── ecosystem.config.cjs        # PM2 do servidor
│   └── openwa-patches/             # Correções do @open-wa/wa-automate
├── package.json                    # Dependências e scripts do app
├── vite.config.ts                  # Configuração do Vite e TanStack Start
├── src/
│   ├── config/
│   │   └── brand.ts                # Definição de marca e suporte
│   ├── components/
│   │   ├── crm/                    # Componentes do CRM Kanban e Lead Drawer
│   │   └── ui/                     # Componentes visuais reutilizáveis (Radix UI)
│   ├── integrations/
│   │   └── supabase/               # Clientes Supabase (browser e server-side)
│   ├── lib/
│   │   ├── ai-prompt.ts            # Engenharia de prompts da IA (Vendedor vs Assistente)
│   │   ├── lead-handover.server.ts # Geração de briefings e transbordo inteligente
│   │   ├── chat-copilot.functions.ts # Funções de copiloto e envio de resumos
│   │   ├── evolution.functions.ts  # Gerenciamento de conexão e teste de respostas
│   │   └── whatsapp-provider/      # Abstração de provedores WhatsApp (OpenWA)
│   └── routes/
│       ├── api/
│       │   └── public/
│       │       └── whatsapp-webhook.ts # Endpoint webhook de mensagens recebidas
│       └── app/
│           ├── agente.tsx          # Painel de configuração do Agente IA & PIX
│           ├── conversas.tsx       # Inbox estilo WhatsApp Web com Copilot
│           ├── crm.tsx             # Quadro Kanban de leads e negociações
│           └── conexao.tsx         # Leitura de QR Code e status do WhatsApp
└── supabase/
    └── migrations/                 # Migrações SQL e estrutura das tabelas
```

---

## Guia de Instalação e Execução Local

### Pré-requisitos

- **Node.js**: Versão 20.x ou superior (recomendado Node 22+)
- **NPM** ou **PNPM**
- **Navegador Chrome/Chromium** instalado (utilizado pelo OpenWA)
- Projeto no **Supabase** configurado com as migrações

### 1. Clonar o Repositório

```bash
git clone https://github.com/arkeestudio/atenddiz.git
cd atenddiz
```

### 2. Instalar as Dependências

```bash
npm install
```

### 3. Configurar o Arquivo `.env`

Copie o modelo de variáveis de ambiente e preencha as credenciais:

```bash
cp .env.example .env
```

### 4. Iniciar os Serviços

Para rodar em desenvolvimento, execute dois terminais:

#### Terminal 1 — Servidor WhatsApp (OpenWA)

Opcional: só é necessário para testar o WhatsApp localmente (em produção ele roda na VM).

```bash
npm --prefix openwa-server install
npm run openwa
```

O servidor iniciará na porta `2785`. Ou aponte `OPENWA_API_URL` para o servidor de produção.

#### Terminal 2 — Aplicação Web (Atenddiz Frontend + API)

```bash
npm run dev -- --port 3000
```

A aplicação estará disponível em `http://localhost:3000`.

---

## Configuração de Variáveis de Ambiente

Crie o arquivo `.env` na raiz do projeto com a seguinte estrutura:

```env
# Supabase
SUPABASE_URL="https://seu-projeto.supabase.co"
SUPABASE_PUBLISHABLE_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
VITE_SUPABASE_URL="https://seu-projeto.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY=""

# IA
GEMINI_API_KEY=""
ANTHROPIC_API_KEY=""

# WhatsApp (OpenWA)
WHATSAPP_PROVIDER="openwa"
OPENWA_API_URL="http://localhost:2785"
OPENWA_API_KEY=""
```

A lista completa está em `.env.example`.

---

## Produção

### App (Vercel)

1. Importe o repositório na Vercel (preset TanStack Start).
2. Cadastre as variáveis de ambiente acima, com `OPENWA_API_URL` apontando para o servidor OpenWA em HTTPS.
3. Conecte o WhatsApp pelo domínio da Vercel (Conexão → Conectar), para o webhook apontar para ele.

### Servidor WhatsApp (VM)

O OpenWA precisa de um processo contínuo com Chrome, então não roda na Vercel. A instalação (Chrome, PM2, nginx e HTTPS) está em [`openwa-server/README.md`](openwa-server/README.md).

```bash
pm2 status
pm2 logs atenddiz-openwa
```

---

## Solução de Problemas Frequentes

### 1. Porta 2785 já está em uso (EADDRINUSE)

Se o processo do OpenWA já estiver em execução em segundo plano:

No Windows (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 2785 | Select-Object OwningProcess
Stop-Process -Id <PID_ENCONTRADO> -Force
```

No Linux:

```bash
fuser -k 2785/tcp
```

### 2. Mensagem não envia para números sem conversa aberta

O servidor OpenWA integrado já possui a correção nativa para resolução de contas Multi-Device (`WAWebQueryExistsJob`) e contorna o bloqueio de números não salvos, garantindo que qualquer número com DDD válido receba mensagens normalmente.

### 3. QR Code não aparece na tela de Conexão

Certifique-se de que o servidor OpenWA está rodando e acessível na URL configurada em `OPENWA_API_URL`, com a mesma `OPENWA_API_KEY`. Em uma VM pequena o primeiro QR pode levar cerca de 40 segundos.

---

## Licença e Direitos

Distribuído sob a licença **MIT**. Consulte `LICENSE` para mais detalhes.

Desenvolvido para máxima performance comercial pela equipe **Atenddiz**.
