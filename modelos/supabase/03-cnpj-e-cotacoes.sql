-- =====================================================================
-- Migração 03 — CNPJ do cliente + histórico de cotações
--
-- Seguro rodar num banco que já tem dados: só acrescenta.
-- Rode DEPOIS de 01-schema.sql e 02-rls.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CNPJ do cliente
--
-- Não vinha nas planilhas de origem — o representante preenche pelo
-- portal, e o valor entra no cabeçalho do pedido.
-- ---------------------------------------------------------------------
alter table public.clientes add column if not exists cnpj text;
alter table public.clientes add column if not exists inscricao_estadual text;

comment on column public.clientes.cnpj is
  'Preenchido pelo representante no portal. Guardado só com dígitos.';

-- Busca por CNPJ ignorando pontuação: quem digita "12345678000199"
-- precisa achar o cliente gravado como "12.345.678/0001-99".
create index if not exists clientes_cnpj_idx
  on public.clientes ((regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')));

-- ---------------------------------------------------------------------
-- 2. COTAÇÕES — histórico por cliente
--
-- Hoje a cotação só existe como rascunho no navegador. Guardando no
-- banco, ela vira histórico: o que cada cliente costuma comprar, com
-- que frequência e em que valor.
--
-- É a base do que o usuário pediu para o futuro: previsão de recompra
-- e aviso de "está na hora de ligar para este cliente".
-- ---------------------------------------------------------------------
create table if not exists public.cotacoes (
  id        text primary key,             -- gerado no cliente (fila offline)
  equipe_id uuid not null references public.equipes(id) on delete cascade,

  representante_id uuid references public.representantes(id) on delete set null,
  cliente_id       uuid references public.clientes(id) on delete set null,

  numero       text,                      -- "Pedido nº" impresso no PDF
  nome_cliente text,                      -- desnormalizado: histórico legível
  data         date not null default current_date,

  -- Situação comercial da cotação. 'enviada' é o padrão: foi gerada e
  -- entregue ao cliente. Os demais dependem do retorno dele.
  situacao text not null default 'enviada'
           check (situacao in ('rascunho','enviada','aprovada','recusada','expirada')),

  total_produtos_centavos integer not null default 0,
  total_ipi_centavos      integer not null default 0,
  total_com_ipi_centavos  integer not null default 0,
  quantidade_itens        integer not null default 0,

  -- Itens gravados como JSON: é uma FOTOGRAFIA do momento da cotação.
  -- Preço muda toda semana; o histórico precisa preservar o que foi
  -- realmente cotado, não o preço de hoje.
  itens jsonb not null default '[]'::jsonb,

  observacoes  text,
  condicoes    jsonb,                     -- pagamento, prazo, validade, frete

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists cotacoes_equipe_data_idx on public.cotacoes (equipe_id, data desc);
create index if not exists cotacoes_cliente_idx     on public.cotacoes (cliente_id, data desc);
create index if not exists cotacoes_rep_idx         on public.cotacoes (representante_id, data desc);

drop trigger if exists cotacoes_atualizado on public.cotacoes;
create trigger cotacoes_atualizado before update on public.cotacoes
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- 3. RLS — mesma regra das outras tabelas: visibilidade por equipe
-- ---------------------------------------------------------------------
alter table public.cotacoes enable row level security;

drop policy if exists "cotacoes: da equipe" on public.cotacoes;
create policy "cotacoes: da equipe"
  on public.cotacoes for all to authenticated
  using      (equipe_id = public.minha_equipe())
  with check (equipe_id = public.minha_equipe());

-- ---------------------------------------------------------------------
-- 4. Visão de apoio à previsão de recompra
--
-- Responde "quando este cliente costuma comprar de novo?" a partir do
-- que já existe. Ainda não alimenta alarme — é o insumo para isso.
-- ---------------------------------------------------------------------
create or replace view public.resumo_cotacoes_cliente as
select
  c.cliente_id,
  c.equipe_id,
  count(*)                                   as total_cotacoes,
  max(c.data)                                as ultima_cotacao,
  min(c.data)                                as primeira_cotacao,
  sum(c.total_com_ipi_centavos)              as valor_total_centavos,
  round(avg(c.total_com_ipi_centavos))       as ticket_medio_centavos,
  -- Intervalo médio entre cotações, em dias. NULL com menos de 2.
  case when count(*) > 1
       then round((max(c.data) - min(c.data))::numeric / (count(*) - 1))
  end                                        as intervalo_medio_dias,
  current_date - max(c.data)                 as dias_desde_ultima
from public.cotacoes c
where c.cliente_id is not null
  and c.situacao <> 'rascunho'
group by c.cliente_id, c.equipe_id;

-- A view herda o RLS da tabela base (security_invoker), então cada
-- equipe só enxerga o próprio resumo.
alter view public.resumo_cotacoes_cliente set (security_invoker = on);

-- =====================================================================
-- CONFERÊNCIA
-- =====================================================================

select 'clientes.cnpj' as item,
       count(*) filter (where cnpj is not null) as preenchidos,
       count(*) as total
  from public.clientes
union all
select 'cotacoes', count(*), count(*) from public.cotacoes;

select tablename, rowsecurity
  from pg_tables where schemaname = 'public' order by tablename;
