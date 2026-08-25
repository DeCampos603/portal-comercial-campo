-- =====================================================================
-- Migração 06 — de quando é a tabela de preços
--
-- O portal já mostrava "atualizado em", mas isso era QUANDO A SINCRONIZAÇÃO
-- RODOU — e ela roda todo dia. O aviso de "tabela velha" comparava com essa
-- data e por isso nunca disparava: o catálogo parecia fresco todo santo dia.
--
-- Foi assim que uma tabela de 31/07 ficou 25 dias no ar sem ninguém notar,
-- com a Action verde e o portal dizendo "Sincronizado". A automação estava
-- perfeita; ela apenas sincronizava fielmente um arquivo parado.
--
-- Esta coluna guarda a data que a PRÓPRIA PLANILHA declara na célula "Data:",
-- que é o que interessa para saber se o preço presta.
--
-- Rode no SQL Editor do Supabase. É idempotente.
-- =====================================================================

alter table public.catalogo add column if not exists data_tabela date;

comment on column public.catalogo.data_tabela is
  'Data declarada na planilha de origem (célula "Data:"), NÃO a data da '
  'sincronização. Usada para avisar que o preço está velho.';

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
select
  data_tabela,
  max(atualizado_em) as ultima_sincronizacao,
  count(*)           as itens
from public.catalogo
group by data_tabela
order by data_tabela desc nulls last;
