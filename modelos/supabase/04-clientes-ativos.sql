-- =====================================================================
-- Migração 04 — a carteira ATIVA
--
-- As planilhas da carga inicial traziam só quem PAROU de comprar:
-- 300 inativos e 28 em recuperação. Os clientes que compram hoje nunca
-- entraram no portal — o mapa e a agenda mostravam a carteira morta e
-- ignoravam a viva.
--
-- Esta migração abre a terceira classificação. Sem ela, o INSERT com
-- origem = 'ativo' é recusado pela constraint e a importação para.
--
-- Rode no SQL Editor do Supabase. É idempotente.
-- =====================================================================

-- A constraint foi criada junto da coluna, em 01-schema.sql, então o nome
-- é o automático do Postgres. Descobri-lo em vez de presumi-lo: se o nome
-- não bater, o DROP silencioso deixaria a regra velha no lugar e o INSERT
-- falharia depois, longe daqui.
do $$
declare
  nome text;
begin
  select conname into nome
    from pg_constraint
   where conrelid = 'public.clientes'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%origem%';

  if nome is not null then
    execute format('alter table public.clientes drop constraint %I', nome);
    raise notice 'constraint antiga removida: %', nome;
  end if;
end $$;

alter table public.clientes
  add constraint clientes_origem_check
  check (origem in ('ativo', 'recuperacao', 'inativo'));

-- Índice por origem: a carteira e o mapa filtram por isto o tempo todo,
-- e agora existe um recorte pequeno (os ativos) dentro de uma tabela grande.
create index if not exists clientes_origem_idx on public.clientes (origem);

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
select origem, count(*) as quantos
  from public.clientes
 group by origem
 order by quantos desc;
