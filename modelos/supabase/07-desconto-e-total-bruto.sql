-- =====================================================================
-- Migração 07 — Total Bruto e Total Desconto em Centavos
--
-- Adiciona colunas dedicadas para total bruto e total de desconto em centavos
-- (inteiros), garantindo precisão financeira absoluta e consultas analíticas
-- diretas via SQL/PostgREST.
--
-- Idempotente: seguro para rodar múltiplas vezes no SQL Editor do Supabase.
-- =====================================================================

alter table public.cotacoes
  add column if not exists total_bruto_centavos bigint,
  add column if not exists total_desconto_centavos bigint default 0;

comment on column public.cotacoes.total_bruto_centavos is
  'Soma dos produtos sem desconto em centavos inteiros (BRL)';

comment on column public.cotacoes.total_desconto_centavos is
  'Total de desconto concedido na cotação em centavos inteiros (BRL)';

-- Preenche retroativamente os registros que já possuem esses valores em `condicoes`
update public.cotacoes
set
  total_desconto_centavos = coalesce((condicoes->>'total_desconto_centavos')::bigint, 0),
  total_bruto_centavos = coalesce(
    (condicoes->>'total_bruto_centavos')::bigint,
    total_produtos_centavos + coalesce((condicoes->>'total_desconto_centavos')::bigint, 0)
  )
where total_bruto_centavos is null;

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
select
  count(*) as total_cotacoes,
  count(*) filter (where total_bruto_centavos is not null) as com_total_bruto,
  count(*) filter (where total_desconto_centavos > 0) as com_desconto
from public.cotacoes;
