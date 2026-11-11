-- =====================================================================
-- Migração 08 — Código único de cotação por equipe
--
-- 1) Se existirem cotações antigas com o mesmo código na mesma equipe,
--    preserva o código original na mais antiga e diferencia as demais
--    para que a criação do índice único não falhe.
-- 2) Impede novos códigos duplicados por equipe (insensível a maiúsculas
--    e espaços nas pontas), mesmo em salvamentos simultâneos.
--
-- Seguro rodar em banco que já possui dados e idempotente.
-- =====================================================================

with duplicadas as (
  select
    id,
    btrim(numero) as numero_limpo,
    row_number() over (
      partition by equipe_id, upper(btrim(numero))
      order by criado_em asc nulls last, atualizado_em asc nulls last, id asc
    ) as ordem
  from public.cotacoes
  where numero is not null
    and btrim(numero) <> ''
)
update public.cotacoes c
set numero = d.numero_limpo || '-DUP-' || d.ordem || '-' || left(md5(c.id), 4)
from duplicadas d
where c.id = d.id
  and d.ordem > 1;

create unique index if not exists cotacoes_equipe_numero_unico_idx
  on public.cotacoes (equipe_id, upper(btrim(numero)))
  where numero is not null and btrim(numero) <> '';
