export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agendamento: {
        Row: {
          card_id: string | null
          company_id: string
          created_at: string
          fim: string
          google_event_id: string | null
          id: string
          inicio: string
          status: string
          titulo: string
        }
        Insert: {
          card_id?: string | null
          company_id: string
          created_at?: string
          fim: string
          google_event_id?: string | null
          id?: string
          inicio: string
          status?: string
          titulo: string
        }
        Update: {
          card_id?: string | null
          company_id?: string
          created_at?: string
          fim?: string
          google_event_id?: string | null
          id?: string
          inicio?: string
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendamento_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "crm_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_config: {
        Row: {
          agendamento_ativo: boolean
          ai_model: string
          ai_provider: string
          antecedencia_min: string
          anthropic_api_key: string
          apresentacao: string
          assinar_mensagens: boolean | null
          base_conhecimento: string
          chamar_por_nome: boolean | null
          chave_pix: string
          como_vender: string
          company_id: string
          cupom: string
          descricao_negocio: string
          diferenciais: string
          duracao_padrao: string
          emoji_intensidade: string | null
          estilo_comunicacao: string
          evitar_palavras: string | null
          faq: string
          foco_atendimento: string | null
          formalidade: number
          formas_pagamento: string
          horarios_atendimento: Json
          horarios_disponiveis: string
          idioma: string | null
          instrucoes_pagamento: string
          mensagem_fora_horario: string
          nao_pode_fazer: string
          nome_agente: string
          nome_empresa: string
          objecoes: string
          ofertas: string
          openai_api_key: string
          palavra_despausar: string
          palavra_pausar: string
          papel_objetivo: string
          pedir_avaliacao: boolean
          perguntar_uma_por_vez: boolean | null
          personalidade: string | null
          pode_brincar: boolean | null
          pode_fazer: string
          politicas: string
          posvenda_msg: string
          proatividade: number | null
          produtos_servicos: string
          publico_alvo: string
          reativar_cliente: boolean
          regiao_horario: string
          responder_em_partes: boolean
          segmento: string
          segundos_buffer: number
          servicos_agendaveis: string
          sobre_empresa: string
          tamanho_resposta: string
          telefone_transferencia: string
          ticket_medio: string
          titular_pix: string
          tom: number
          updated_at: string
          usar_emojis: boolean
          usar_girias: boolean | null
          user_id: string
          velocidade_resposta: string | null
        }
        Insert: {
          agendamento_ativo?: boolean
          ai_model?: string
          ai_provider?: string
          antecedencia_min?: string
          anthropic_api_key?: string
          apresentacao?: string
          assinar_mensagens?: boolean | null
          base_conhecimento?: string
          chamar_por_nome?: boolean | null
          chave_pix?: string
          como_vender?: string
          company_id: string
          cupom?: string
          descricao_negocio?: string
          diferenciais?: string
          duracao_padrao?: string
          emoji_intensidade?: string | null
          estilo_comunicacao?: string
          evitar_palavras?: string | null
          faq?: string
          foco_atendimento?: string | null
          formalidade?: number
          formas_pagamento?: string
          horarios_atendimento?: Json
          horarios_disponiveis?: string
          idioma?: string | null
          instrucoes_pagamento?: string
          mensagem_fora_horario?: string
          nao_pode_fazer?: string
          nome_agente?: string
          nome_empresa?: string
          objecoes?: string
          ofertas?: string
          openai_api_key?: string
          palavra_despausar?: string
          palavra_pausar?: string
          papel_objetivo?: string
          pedir_avaliacao?: boolean
          perguntar_uma_por_vez?: boolean | null
          personalidade?: string | null
          pode_brincar?: boolean | null
          pode_fazer?: string
          politicas?: string
          posvenda_msg?: string
          proatividade?: number | null
          produtos_servicos?: string
          publico_alvo?: string
          reativar_cliente?: boolean
          regiao_horario?: string
          responder_em_partes?: boolean
          segmento?: string
          segundos_buffer?: number
          servicos_agendaveis?: string
          sobre_empresa?: string
          tamanho_resposta?: string
          telefone_transferencia?: string
          ticket_medio?: string
          titular_pix?: string
          tom?: number
          updated_at?: string
          usar_emojis?: boolean
          usar_girias?: boolean | null
          user_id: string
          velocidade_resposta?: string | null
        }
        Update: {
          agendamento_ativo?: boolean
          ai_model?: string
          ai_provider?: string
          antecedencia_min?: string
          anthropic_api_key?: string
          apresentacao?: string
          assinar_mensagens?: boolean | null
          base_conhecimento?: string
          chamar_por_nome?: boolean | null
          chave_pix?: string
          como_vender?: string
          company_id?: string
          cupom?: string
          descricao_negocio?: string
          diferenciais?: string
          duracao_padrao?: string
          emoji_intensidade?: string | null
          estilo_comunicacao?: string
          evitar_palavras?: string | null
          faq?: string
          foco_atendimento?: string | null
          formalidade?: number
          formas_pagamento?: string
          horarios_atendimento?: Json
          horarios_disponiveis?: string
          idioma?: string | null
          instrucoes_pagamento?: string
          mensagem_fora_horario?: string
          nao_pode_fazer?: string
          nome_agente?: string
          nome_empresa?: string
          objecoes?: string
          ofertas?: string
          openai_api_key?: string
          palavra_despausar?: string
          palavra_pausar?: string
          papel_objetivo?: string
          pedir_avaliacao?: boolean
          perguntar_uma_por_vez?: boolean | null
          personalidade?: string | null
          pode_brincar?: boolean | null
          pode_fazer?: string
          politicas?: string
          posvenda_msg?: string
          proatividade?: number | null
          produtos_servicos?: string
          publico_alvo?: string
          reativar_cliente?: boolean
          regiao_horario?: string
          responder_em_partes?: boolean
          segmento?: string
          segundos_buffer?: number
          servicos_agendaveis?: string
          sobre_empresa?: string
          tamanho_resposta?: string
          telefone_transferencia?: string
          ticket_medio?: string
          titular_pix?: string
          tom?: number
          updated_at?: string
          usar_emojis?: boolean
          usar_girias?: boolean | null
          user_id?: string
          velocidade_resposta?: string | null
        }
        Relationships: []
      }
      api_token: {
        Row: {
          company_id: string
          created_at: string
          criado_por: string | null
          id: string
          label: string
          revogado: boolean
          token: string
          ultimo_uso_em: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          criado_por?: string | null
          id?: string
          label: string
          revogado?: boolean
          token?: string
          ultimo_uso_em?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          criado_por?: string | null
          id?: string
          label?: string
          revogado?: boolean
          token?: string
          ultimo_uso_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_token_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          id: boolean
          super_admin_emails: string[]
          updated_at: string
        }
        Insert: {
          id?: boolean
          super_admin_emails?: string[]
          updated_at?: string
        }
        Update: {
          id?: boolean
          super_admin_emails?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          acao: string
          actor_email: string | null
          company_id: string
          created_at: string
          detalhes: Json | null
          id: string
          ip: string | null
          recurso: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          acao: string
          actor_email?: string | null
          company_id: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          ip?: string | null
          recurso?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          acao?: string
          actor_email?: string | null
          company_id?: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          ip?: string | null
          recurso?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_event_log: {
        Row: {
          buyer_email: string | null
          created_at: string
          error: string | null
          event_type: string | null
          external_id: string | null
          id: string
          matched_company_id: string | null
          payload: Json
          processed: boolean
          provider: string
        }
        Insert: {
          buyer_email?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: string
          matched_company_id?: string | null
          payload?: Json
          processed?: boolean
          provider: string
        }
        Update: {
          buyer_email?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: string
          matched_company_id?: string | null
          payload?: Json
          processed?: boolean
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_event_log_matched_company_id_fkey"
            columns: ["matched_company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign: {
        Row: {
          agendado_para: string | null
          company_id: string
          concluido_em: string | null
          created_at: string
          created_by: string | null
          filtro_tags: string[] | null
          id: string
          iniciado_em: string | null
          intervalo_max_seg: number
          intervalo_min_seg: number
          media_url: string | null
          mensagem: string
          nome: string
          pausa_apos_envios: number
          pausa_duracao_min: number
          proximo_envio_em: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          total_destinatarios: number
          total_enviados: number
          total_falhas: number
          updated_at: string
        }
        Insert: {
          agendado_para?: string | null
          company_id: string
          concluido_em?: string | null
          created_at?: string
          created_by?: string | null
          filtro_tags?: string[] | null
          id?: string
          iniciado_em?: string | null
          intervalo_max_seg?: number
          intervalo_min_seg?: number
          media_url?: string | null
          mensagem: string
          nome: string
          pausa_apos_envios?: number
          pausa_duracao_min?: number
          proximo_envio_em?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_destinatarios?: number
          total_enviados?: number
          total_falhas?: number
          updated_at?: string
        }
        Update: {
          agendado_para?: string | null
          company_id?: string
          concluido_em?: string | null
          created_at?: string
          created_by?: string | null
          filtro_tags?: string[] | null
          id?: string
          iniciado_em?: string | null
          intervalo_max_seg?: number
          intervalo_min_seg?: number
          media_url?: string | null
          mensagem?: string
          nome?: string
          pausa_apos_envios?: number
          pausa_duracao_min?: number
          proximo_envio_em?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_destinatarios?: number
          total_enviados?: number
          total_falhas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_target: {
        Row: {
          campaign_id: string
          company_id: string
          contato_nome: string | null
          contato_numero: string
          created_at: string
          enviado_em: string | null
          erro: string | null
          id: string
          status: Database["public"]["Enums"]["campaign_target_status"]
        }
        Insert: {
          campaign_id: string
          company_id: string
          contato_nome?: string | null
          contato_numero: string
          created_at?: string
          enviado_em?: string | null
          erro?: string | null
          id?: string
          status?: Database["public"]["Enums"]["campaign_target_status"]
        }
        Update: {
          campaign_id?: string
          company_id?: string
          contato_nome?: string | null
          contato_numero?: string
          created_at?: string
          enviado_em?: string | null
          erro?: string | null
          id?: string
          status?: Database["public"]["Enums"]["campaign_target_status"]
        }
        Relationships: [
          {
            foreignKeyName: "campaign_target_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_target_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      company: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj_cpf: string | null
          complemento: string | null
          created_at: string
          created_by: string | null
          creditos_origem: string
          creditos_resetam_em: string | null
          creditos_saldo: number
          email_corporativo: string | null
          estado: string | null
          financeiro_ativo: boolean
          financeiro_dias_vencimento_padrao: number
          id: string
          inscricao_estadual: string | null
          logo_url: string | null
          nome: string
          nome_fantasia: string | null
          numero: string | null
          onboarding_completed: boolean
          onboarding_step: number
          pais: string | null
          porte: string | null
          primary_color: string
          razao_social: string | null
          rua: string | null
          segmento: string | null
          selected_plan_slug: string | null
          site: string | null
          slug: string
          status_cobranca: string
          telefone: string | null
          tipo_pessoa: string
          trial_ate: string
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          complemento?: string | null
          created_at?: string
          created_by?: string | null
          creditos_origem?: string
          creditos_resetam_em?: string | null
          creditos_saldo?: number
          email_corporativo?: string | null
          estado?: string | null
          financeiro_ativo?: boolean
          financeiro_dias_vencimento_padrao?: number
          id?: string
          inscricao_estadual?: string | null
          logo_url?: string | null
          nome: string
          nome_fantasia?: string | null
          numero?: string | null
          onboarding_completed?: boolean
          onboarding_step?: number
          pais?: string | null
          porte?: string | null
          primary_color?: string
          razao_social?: string | null
          rua?: string | null
          segmento?: string | null
          selected_plan_slug?: string | null
          site?: string | null
          slug: string
          status_cobranca?: string
          telefone?: string | null
          tipo_pessoa?: string
          trial_ate?: string
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          complemento?: string | null
          created_at?: string
          created_by?: string | null
          creditos_origem?: string
          creditos_resetam_em?: string | null
          creditos_saldo?: number
          email_corporativo?: string | null
          estado?: string | null
          financeiro_ativo?: boolean
          financeiro_dias_vencimento_padrao?: number
          id?: string
          inscricao_estadual?: string | null
          logo_url?: string | null
          nome?: string
          nome_fantasia?: string | null
          numero?: string | null
          onboarding_completed?: boolean
          onboarding_step?: number
          pais?: string | null
          porte?: string | null
          primary_color?: string
          razao_social?: string | null
          rua?: string | null
          segmento?: string | null
          selected_plan_slug?: string | null
          site?: string | null
          slug?: string
          status_cobranca?: string
          telefone?: string | null
          tipo_pessoa?: string
          trial_ate?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_billing: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj_cpf: string | null
          company_id: string
          complemento: string | null
          created_at: string
          email_cobranca: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          nome_responsavel: string | null
          numero: string | null
          pais: string | null
          razao_social: string | null
          rua: string | null
          telefone: string | null
          tipo_pessoa: string
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          company_id: string
          complemento?: string | null
          created_at?: string
          email_cobranca?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          nome_responsavel?: string | null
          numero?: string | null
          pais?: string | null
          razao_social?: string | null
          rua?: string | null
          telefone?: string | null
          tipo_pessoa?: string
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          company_id?: string
          complemento?: string | null
          created_at?: string
          email_cobranca?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          nome_responsavel?: string | null
          numero?: string | null
          pais?: string | null
          razao_social?: string | null
          rua?: string | null
          telefone?: string | null
          tipo_pessoa?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_billing_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      company_user: {
        Row: {
          ativo: boolean
          company_id: string
          convite_token: string | null
          created_at: string
          forcar_troca_senha: boolean
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          company_id: string
          convite_token?: string | null
          created_at?: string
          forcar_troca_senha?: boolean
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          company_id?: string
          convite_token?: string | null
          created_at?: string
          forcar_troca_senha?: boolean
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_user_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_pause: {
        Row: {
          company_id: string
          numero: string
          pausado: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          numero: string
          pausado?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          numero?: string
          pausado?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          delta: number
          id: string
          motivo: string
          ref: string | null
          saldo_apos: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          motivo: string
          ref?: string | null
          saldo_apos: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          motivo?: string
          ref?: string | null
          saldo_apos?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cards: {
        Row: {
          company_id: string
          follow_up: string | null
          id: string
          nome: string | null
          numero: string
          observacao: string | null
          origem: string | null
          owner_id: string | null
          proxima_acao: string | null
          stage_id: string | null
          status: string
          tags: string[]
          ultima_em: string
          ultima_mensagem: string | null
          updated_at: string
          user_id: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          valor: number
        }
        Insert: {
          company_id: string
          follow_up?: string | null
          id?: string
          nome?: string | null
          numero: string
          observacao?: string | null
          origem?: string | null
          owner_id?: string | null
          proxima_acao?: string | null
          stage_id?: string | null
          status?: string
          tags?: string[]
          ultima_em?: string
          ultima_mensagem?: string | null
          updated_at?: string
          user_id: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          valor?: number
        }
        Update: {
          company_id?: string
          follow_up?: string | null
          id?: string
          nome?: string | null
          numero?: string
          observacao?: string | null
          origem?: string | null
          owner_id?: string | null
          proxima_acao?: string | null
          stage_id?: string | null
          status?: string
          tags?: string[]
          ultima_em?: string
          ultima_mensagem?: string | null
          updated_at?: string
          user_id?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_cards_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stage"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stage: {
        Row: {
          company_id: string
          cor: string
          created_at: string
          id: string
          nome: string
          ordem: number
          tipo: Database["public"]["Enums"]["stage_tipo"]
        }
        Insert: {
          company_id: string
          cor?: string
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          tipo?: Database["public"]["Enums"]["stage_tipo"]
        }
        Update: {
          company_id?: string
          cor?: string
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          tipo?: Database["public"]["Enums"]["stage_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_stage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      csat_response: {
        Row: {
          comentario: string | null
          company_id: string
          contato_nome: string | null
          created_at: string
          enviado_em: string
          enviado_por: string | null
          id: string
          numero: string
          respondido_em: string | null
          score: number | null
          token: string
          updated_at: string
        }
        Insert: {
          comentario?: string | null
          company_id: string
          contato_nome?: string | null
          created_at?: string
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          numero: string
          respondido_em?: string | null
          score?: number | null
          token?: string
          updated_at?: string
        }
        Update: {
          comentario?: string | null
          company_id?: string
          contato_nome?: string | null
          created_at?: string
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          numero?: string
          respondido_em?: string | null
          score?: number | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "csat_response_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_categoria: {
        Row: {
          ativo: boolean
          company_id: string
          cor: string
          created_at: string
          id: string
          nome: string
          tipo: Database["public"]["Enums"]["fin_tipo"]
        }
        Insert: {
          ativo?: boolean
          company_id: string
          cor?: string
          created_at?: string
          id?: string
          nome: string
          tipo: Database["public"]["Enums"]["fin_tipo"]
        }
        Update: {
          ativo?: boolean
          company_id?: string
          cor?: string
          created_at?: string
          id?: string
          nome?: string
          tipo?: Database["public"]["Enums"]["fin_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "fin_categoria_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_lancamento: {
        Row: {
          anexo_url: string | null
          categoria_id: string | null
          company_id: string
          competencia: string
          contato_numero: string | null
          created_at: string
          created_by: string | null
          crm_card_id: string | null
          descricao: string
          forma_pagamento: Database["public"]["Enums"]["fin_forma"] | null
          id: string
          observacao: string | null
          pago_em: string | null
          status: Database["public"]["Enums"]["fin_status"]
          tipo: Database["public"]["Enums"]["fin_tipo"]
          updated_at: string
          valor_cents: number
          vencimento: string
        }
        Insert: {
          anexo_url?: string | null
          categoria_id?: string | null
          company_id: string
          competencia?: string
          contato_numero?: string | null
          created_at?: string
          created_by?: string | null
          crm_card_id?: string | null
          descricao: string
          forma_pagamento?: Database["public"]["Enums"]["fin_forma"] | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          tipo: Database["public"]["Enums"]["fin_tipo"]
          updated_at?: string
          valor_cents: number
          vencimento: string
        }
        Update: {
          anexo_url?: string | null
          categoria_id?: string | null
          company_id?: string
          competencia?: string
          contato_numero?: string | null
          created_at?: string
          created_by?: string | null
          crm_card_id?: string | null
          descricao?: string
          forma_pagamento?: Database["public"]["Enums"]["fin_forma"] | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          tipo?: Database["public"]["Enums"]["fin_tipo"]
          updated_at?: string
          valor_cents?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_lancamento_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "fin_categoria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_lancamento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_lancamento_crm_card_id_fkey"
            columns: ["crm_card_id"]
            isOneToOne: false
            referencedRelation: "crm_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      google_integration: {
        Row: {
          access_token: string | null
          calendar_id: string | null
          company_id: string
          conectado: boolean
          email: string | null
          expiry: string | null
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          calendar_id?: string | null
          company_id: string
          conectado?: boolean
          email?: string | null
          expiry?: string | null
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          calendar_id?: string | null
          company_id?: string
          conectado?: boolean
          email?: string | null
          expiry?: string | null
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_integration_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_evento: {
        Row: {
          card_id: string
          company_id: string
          created_at: string
          descricao: string | null
          id: string
          tipo: string
        }
        Insert: {
          card_id: string
          company_id: string
          created_at?: string
          descricao?: string | null
          id?: string
          tipo: string
        }
        Update: {
          card_id?: string
          company_id?: string
          created_at?: string
          descricao?: string | null
          id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_evento_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "crm_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_nota: {
        Row: {
          autor_id: string | null
          card_id: string
          company_id: string
          created_at: string
          id: string
          texto: string
        }
        Insert: {
          autor_id?: string | null
          card_id: string
          company_id: string
          created_at?: string
          id?: string
          texto: string
        }
        Update: {
          autor_id?: string | null
          card_id?: string
          company_id?: string
          created_at?: string
          id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_nota_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "crm_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_nota_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens: {
        Row: {
          autor: string
          company_id: string
          contato_nome: string | null
          created_at: string
          direcao: string
          id: string
          numero: string
          texto: string
          user_id: string
          whatsapp_message_id: string | null
        }
        Insert: {
          autor: string
          company_id: string
          contato_nome?: string | null
          created_at?: string
          direcao: string
          id?: string
          numero: string
          texto: string
          user_id: string
          whatsapp_message_id?: string | null
        }
        Update: {
          autor?: string
          company_id?: string
          contato_nome?: string | null
          created_at?: string
          direcao?: string
          id?: string
          numero?: string
          texto?: string
          user_id?: string
          whatsapp_message_id?: string | null
        }
        Relationships: []
      }
      message_template: {
        Row: {
          atalho: string
          company_id: string
          created_at: string
          id: string
          texto: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          atalho: string
          company_id: string
          created_at?: string
          id?: string
          texto: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          atalho?: string
          company_id?: string
          created_at?: string
          id?: string
          texto?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_template_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      plan: {
        Row: {
          ativo: boolean
          checkout_url: string | null
          created_at: string
          creditos_mensais: number
          creditos_trial: number
          descricao: string | null
          destaque: boolean
          features: Json
          id: string
          intervalo: string
          limite_contatos: number
          limite_instancias: number
          limite_mensagens: number
          limite_usuarios: number
          moeda: string
          nome: string
          ordem: number
          paddle_price_id: string | null
          paddle_product_id: string | null
          preco_cents: number
          slug: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          trial_days: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          checkout_url?: string | null
          created_at?: string
          creditos_mensais?: number
          creditos_trial?: number
          descricao?: string | null
          destaque?: boolean
          features?: Json
          id?: string
          intervalo?: string
          limite_contatos?: number
          limite_instancias?: number
          limite_mensagens?: number
          limite_usuarios?: number
          moeda?: string
          nome: string
          ordem?: number
          paddle_price_id?: string | null
          paddle_product_id?: string | null
          preco_cents?: number
          slug: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          trial_days?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          checkout_url?: string | null
          created_at?: string
          creditos_mensais?: number
          creditos_trial?: number
          descricao?: string | null
          destaque?: boolean
          features?: Json
          id?: string
          intervalo?: string
          limite_contatos?: number
          limite_instancias?: number
          limite_mensagens?: number
          limite_usuarios?: number
          moeda?: string
          nome?: string
          ordem?: number
          paddle_price_id?: string | null
          paddle_product_id?: string | null
          preco_cents?: number
          slug?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      produto: {
        Row: {
          ativo: boolean
          company_id: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          ordem: number
          preco: number
        }
        Insert: {
          ativo?: boolean
          company_id: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number
          preco?: number
        }
        Update: {
          ativo?: boolean
          company_id?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number
          preco?: number
        }
        Relationships: [
          {
            foreignKeyName: "produto_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          cargo: string | null
          cpf: string | null
          created_at: string
          email: string | null
          nome: string | null
          nome_completo: string | null
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cargo?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          nome?: string | null
          nome_completo?: string | null
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cargo?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          nome?: string | null
          nome_completo?: string | null
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription: {
        Row: {
          buyer_email: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          company_id: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          external_customer_id: string | null
          external_subscription_id: string | null
          id: string
          metadata: Json
          next_billing_amount_cents: number | null
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          payment_method_brand: string | null
          payment_method_exp: string | null
          payment_method_last4: string | null
          plan_id: string | null
          provider: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          buyer_email?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          company_id: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_customer_id?: string | null
          external_subscription_id?: string | null
          id?: string
          metadata?: Json
          next_billing_amount_cents?: number | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          payment_method_brand?: string | null
          payment_method_exp?: string | null
          payment_method_last4?: string | null
          plan_id?: string | null
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          buyer_email?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          company_id?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_customer_id?: string | null
          external_subscription_id?: string | null
          id?: string
          metadata?: Json
          next_billing_amount_cents?: number | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          payment_method_brand?: string | null
          payment_method_exp?: string | null
          payment_method_last4?: string | null
          plan_id?: string | null
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_delivery_log: {
        Row: {
          company_id: string
          created_at: string
          endpoint_id: string | null
          erro: string | null
          evento: string
          id: string
          status_code: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          endpoint_id?: string | null
          erro?: string | null
          evento: string
          id?: string
          status_code?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          endpoint_id?: string | null
          erro?: string | null
          evento?: string
          id?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_delivery_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_delivery_log_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoint"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoint: {
        Row: {
          ativo: boolean
          company_id: string
          created_at: string
          eventos: string[]
          id: string
          nome: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          ativo?: boolean
          company_id: string
          created_at?: string
          eventos?: string[]
          id?: string
          nome: string
          secret?: string
          updated_at?: string
          url: string
        }
        Update: {
          ativo?: boolean
          company_id?: string
          created_at?: string
          eventos?: string[]
          id?: string
          nome?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoint_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          company_id: string
          instance_name: string
          numero: string | null
          status: string
          updated_at: string
          user_id: string
          webhook_configured_at: string | null
          webhook_token: string
        }
        Insert: {
          company_id: string
          instance_name: string
          numero?: string | null
          status?: string
          updated_at?: string
          user_id: string
          webhook_configured_at?: string | null
          webhook_token?: string
        }
        Update: {
          company_id?: string
          instance_name?: string
          numero?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          webhook_configured_at?: string | null
          webhook_token?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_super_admin_if_empty: { Args: never; Returns: undefined }
      consume_ai_credit: {
        Args: { _company_id: string; _ref?: string }
        Returns: boolean
      }
      current_company_id: { Args: never; Returns: string }
      fin_enable_for_company: {
        Args: { _company_id: string; _enable: boolean }
        Returns: undefined
      }
      grant_credits: {
        Args: { _company_id: string; _motivo?: string; _qtd: number }
        Returns: number
      }
      has_company_access: { Args: { _company_id: string }; Returns: boolean }
      has_company_role: {
        Args: { _company_id: string; _roles: string[] }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      seed_fin_categorias: { Args: { _company_id: string }; Returns: undefined }
      topup_plan_credits: {
        Args: { _company_id: string; _plan_slug: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "super_admin"
      campaign_status:
        | "rascunho"
        | "agendada"
        | "enviando"
        | "pausada"
        | "concluida"
        | "cancelada"
      campaign_target_status: "pendente" | "enviado" | "falhou" | "pulado"
      fin_forma:
        | "pix"
        | "boleto"
        | "cartao"
        | "dinheiro"
        | "transferencia"
        | "outro"
      fin_status: "pendente" | "pago" | "atrasado" | "cancelado"
      fin_tipo: "receita" | "despesa"
      stage_tipo: "normal" | "ganho" | "perda"
      tenant_role: "owner" | "admin" | "atendente"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin"],
      campaign_status: [
        "rascunho",
        "agendada",
        "enviando",
        "pausada",
        "concluida",
        "cancelada",
      ],
      campaign_target_status: ["pendente", "enviado", "falhou", "pulado"],
      fin_forma: [
        "pix",
        "boleto",
        "cartao",
        "dinheiro",
        "transferencia",
        "outro",
      ],
      fin_status: ["pendente", "pago", "atrasado", "cancelado"],
      fin_tipo: ["receita", "despesa"],
      stage_tipo: ["normal", "ganho", "perda"],
      tenant_role: ["owner", "admin", "atendente"],
    },
  },
} as const
