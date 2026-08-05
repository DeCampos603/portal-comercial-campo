-- =====================================================================
-- Migração 05 — histórico de cotações que se pode REGERAR
--
-- A tabela já guardava os itens como fotografia do momento, porque o preço
-- muda toda semana e o histórico não pode mudar junto. Faltava o resto do
-- documento: o cliente, os dados da representação e o nome do vendedor.
--
-- Sem eles, regerar um PDF de dois meses atrás usaria o cadastro de HOJE.
-- Se o CNPJ do cliente foi preenchido depois, ou o endereço corrigido, ou a
-- I.E. da representação cadastrada, o PDF "regerado" sairia diferente do que
-- o cliente tem na mão. Num documento comercial isso não é detalhe.
--
-- Rode no SQL Editor do Supabase. É idempotente.
-- =====================================================================

alter table public.cotacoes add column if not exists vendedor text;

-- Fotografia do cliente no momento da emissão: razão social, CNPJ, I.E.,
-- endereço, contato. Só o que o PDF imprime — nada de saldo ou situação
-- comercial, que são dados internos e não entram no papel.
alter table public.cotacoes add column if not exists cliente jsonb;

-- Fotografia da representação (razão social, CNPJ, I.E., contato).
alter table public.cotacoes add column if not exists empresa jsonb;

-- O histórico é sempre lido em ordem de data, da mais recente para a mais
-- antiga. Sem índice isso vira varredura da tabela inteira a cada abertura.
create index if not exists cotacoes_data_idx
  on public.cotacoes (equipe_id, data desc);

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
select
  count(*)                                    as cotacoes,
  count(*) filter (where cliente is not null) as com_fotografia_do_cliente,
  count(*) filter (where vendedor is not null) as com_vendedor
from public.cotacoes;
