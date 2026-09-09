-- Migration: Garantir que não existam etapas duplicadas no CRM por empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_stage_unique_company_nome 
ON public.crm_stage(company_id, lower(trim(nome)));
