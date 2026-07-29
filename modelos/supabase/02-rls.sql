-- =====================================================================
-- Portal Comercial de Campo — Row Level Security
--
-- 🔴 ESTE ARQUIVO É A FRONTEIRA DE SEGURANÇA DO PORTAL.
--
-- A chave publishable fica exposta no JavaScript (é assim por design).
-- Quem protege os dados é o RLS. Tabela sem RLS = dado público.
--
-- MODELO: visibilidade por EQUIPE. Todos os representantes de uma equipe
--         enxergam a mesma carteira e a mesma agenda.
--
-- Rode DEPOIS de 01-schema.sql.
-- =====================================================================

alter table public.equipes        enable row level security;
alter table public.representantes enable row level security;
alter table public.catalogo       enable row level security;
alter table public.clientes       enable row level security;
alter table public.visitas        enable row level security;

-- ---------------------------------------------------------------------
-- Funções de autorização.
--
-- Qualquer conta criada no projeto (inclusive uma de teste) consegue um
-- token 'authenticated' válido. Ser autenticado NÃO basta: é preciso
-- estar cadastrado em `representantes` e ativo.
-- ---------------------------------------------------------------------

-- Devolve a equipe do usuário logado, ou NULL se ele não for
-- representante ativo. NULL nunca casa em comparação, então quem não
-- está na allowlist simplesmente não enxerga linha nenhuma.
create or replace function public.minha_equipe()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.equipe_id
    from public.representantes r
   where r.id = auth.uid() and r.ativo;
$$;

create or replace function public.eh_representante_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.representantes r
    where r.id = auth.uid() and r.ativo
  );
$$;

-- ---------------------------------------------------------------------
-- EQUIPES — cada um lê só a própria equipe.
-- ---------------------------------------------------------------------
drop policy if exists "equipes: a propria" on public.equipes;
create policy "equipes: a propria"
  on public.equipes for select to authenticated
  using (id = public.minha_equipe());

-- ---------------------------------------------------------------------
-- REPRESENTANTES — enxerga os colegas da própria equipe.
-- (Necessário para mostrar "agendado por Fulano" na agenda compartilhada.)
-- Sem policy de INSERT/UPDATE: cadastro é manual, pelo painel.
-- ---------------------------------------------------------------------
drop policy if exists "representantes: proprio perfil"    on public.representantes;
drop policy if exists "representantes: colegas de equipe" on public.representantes;
create policy "representantes: colegas de equipe"
  on public.representantes for select to authenticated
  using (id = auth.uid() or equipe_id = public.minha_equipe());

-- ---------------------------------------------------------------------
-- CATÁLOGO — leitura para representante ativo. Escrita: ninguém.
--
-- ⚠️ NUNCA troque por `using (true)`. Isso liberaria a tabela de preços
--    e os saldos para qualquer conta autenticada, cadastrada ou não.
--
-- A sincronização grava com service_role, que ignora RLS — por isso não
-- existe policy de INSERT/UPDATE aqui.
-- ---------------------------------------------------------------------
drop policy if exists "catalogo: leitura de representante ativo" on public.catalogo;
create policy "catalogo: leitura de representante ativo"
  on public.catalogo for select to authenticated
  using (public.eh_representante_ativo());

-- ---------------------------------------------------------------------
-- CLIENTES — carteira compartilhada dentro da equipe.
--
-- `with check` NÃO é opcional: sem ele, alguém consegue INSERIR linha
-- apontando para a equipe de outra pessoa.
-- ---------------------------------------------------------------------
drop policy if exists "clientes: apenas os proprios" on public.clientes;
drop policy if exists "clientes: da equipe"          on public.clientes;
create policy "clientes: da equipe"
  on public.clientes for all to authenticated
  using      (equipe_id = public.minha_equipe())
  with check (equipe_id = public.minha_equipe());

-- ---------------------------------------------------------------------
-- VISITAS — agenda compartilhada dentro da equipe.
-- ---------------------------------------------------------------------
drop policy if exists "visitas: apenas as proprias" on public.visitas;
drop policy if exists "visitas: da equipe"          on public.visitas;
create policy "visitas: da equipe"
  on public.visitas for all to authenticated
  using      (equipe_id = public.minha_equipe())
  with check (equipe_id = public.minha_equipe());

-- =====================================================================
-- CONFERÊNCIA — rode depois de aplicar
-- =====================================================================

-- 1. Toda tabela pública precisa ter RLS ligado (rowsecurity = true).
--    Qualquer 'false' aqui é dado exposto.
select schemaname, tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;

-- 2. Nenhuma policy pode ter qual = 'true' sem qualificação.
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- =====================================================================
-- ADICIONAR UM REPRESENTANTE DEPOIS
--
-- 1. Authentication → Users → Add user (e-mail e senha).
-- 2. Copie o uuid gerado.
-- 3. Rode, apontando para a MESMA equipe se ele deve ver a mesma carteira:
--
--   insert into public.representantes (id, equipe_id, nome, email, codigo_sigma)
--   values ('<uuid>', (select id from public.equipes limit 1),
--           '<nome>', '<e-mail>', '25');
--
-- Antes do passo 3, a conta existe mas não vê nada — é o esperado.
--
-- Revogar acesso, sem apagar a conta nem o histórico de visitas:
--   update public.representantes set ativo = false where id = '<uuid>';
-- =====================================================================
