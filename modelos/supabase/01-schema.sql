-- =====================================================================
-- Portal Comercial de Campo — esquema
-- Rode no SQL Editor do Supabase. Depois rode 02-rls.sql.
--
-- MODELO: carteira COMPARTILHADA por equipe.
--   Todos os representantes de uma equipe enxergam os mesmos clientes
--   e a mesma agenda. `representante_id` continua registrando QUEM fez
--   cada coisa — serve para relatório, não para visibilidade.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EQUIPES — a unidade de compartilhamento
-- ---------------------------------------------------------------------
create table if not exists public.equipes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- REPRESENTANTES
-- É o perfil E a allowlist: quem não tem linha aqui não enxerga nada.
-- ---------------------------------------------------------------------
create table if not exists public.representantes (
  id            uuid primary key references auth.users(id) on delete cascade,
  equipe_id     uuid references public.equipes(id) on delete restrict,
  nome          text not null,
  email         text,
  codigo_sigma  text,                        -- ex.: '25' de "M A JOAQUIM REPRESENTACAO [25]"
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

comment on table public.representantes is
  'Allowlist do portal. Sem linha aqui (ou com ativo=false), o usuário não vê nada.';
comment on column public.representantes.equipe_id is
  'Define O QUE a pessoa enxerga: toda a carteira e agenda da equipe.';

-- ---------------------------------------------------------------------
-- CATÁLOGO
-- Compartilhado por TODOS os representantes ativos (é a tabela da Sigma).
-- Escrita só pela sincronização (service_role).
-- ---------------------------------------------------------------------
create table if not exists public.catalogo (
  codigo_sigma            text primary key,
  codigo_fabricante       text,              -- OEM; TEM duplicata, nunca é chave
  descricao               text,
  valor_unitario_centavos integer,           -- inteiro sempre; null = sem preço
  ipi                     numeric(6,4) not null default 0,
  st                      boolean not null default false,
  categoria               text,
  grupo                   text,
  saldo                   integer,

  -- 🚦 Semáforo de estoque: fonte ÚNICA da verdade, calculada pelo banco.
  -- Limiares extraídos da formatação condicional da planilha original.
  -- O caso saldo = 6 cai em 'baixo' (na planilha ele fica sem cor — bug).
  status_estoque text generated always as (
    case
      when saldo is null   then null
      when saldo < 6       then 'sem_estoque'
      when saldo < 200     then 'baixo'
      else                      'ok'
    end
  ) stored,

  atualizado_em timestamptz not null default now()
);

create index if not exists catalogo_grupo_idx   on public.catalogo (grupo);
create index if not exists catalogo_estoque_idx on public.catalogo (status_estoque);

create index if not exists catalogo_busca_idx on public.catalogo
  using gin (to_tsvector('portuguese',
    coalesce(codigo_sigma,'') || ' ' ||
    coalesce(codigo_fabricante,'') || ' ' ||
    coalesce(descricao,'')));

-- ---------------------------------------------------------------------
-- CLIENTES — carteira da EQUIPE
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
  id        uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes(id) on delete cascade,

  -- Responsável pela conta. Não controla visibilidade — só informa.
  representante_id uuid references public.representantes(id) on delete set null,

  codigo  text not null,                     -- código Sigma do cliente
  nome    text not null,
  origem  text not null check (origem in ('ativo','recuperacao','inativo')),
  status  text check (status in ('Sem Título','Com Título','Atrasado')),

  contato   text,                            -- 100% vazio na origem: preenchido no portal
  telefone  text,
  whatsapp  text,                            -- E.164, para links wa.me
  email     text,

  logradouro text,                           -- sem número na origem
  bairro     text,
  cidade     text,
  uf         text,
  cep        text,

  lat          double precision,
  lng          double precision,
  geo_precisao text check (geo_precisao in ('rua','bairro','cidade')),

  grupo_economico text,                      -- agrupa matriz/filial
  notas           text,
  ultima_visita   date,

  atualizado_em timestamptz not null default now(),

  unique (equipe_id, codigo)
);

create index if not exists clientes_equipe_idx  on public.clientes (equipe_id);
create index if not exists clientes_status_idx  on public.clientes (equipe_id, status);
create index if not exists clientes_cidade_idx  on public.clientes (equipe_id, cidade, bairro);

-- ---------------------------------------------------------------------
-- VISITAS — agenda da EQUIPE
-- id é TEXT gerado no cliente: a fila offline reenvia, e o upsert
-- por chave primária garante que reenvio não duplique.
-- ---------------------------------------------------------------------
create table if not exists public.visitas (
  id        text primary key,                -- ex.: 'vis_20260803_21142'
  equipe_id uuid not null references public.equipes(id) on delete cascade,

  -- Quem agendou/realizou. Base dos relatórios por pessoa.
  representante_id uuid references public.representantes(id) on delete set null,
  cliente_id       uuid references public.clientes(id) on delete set null,

  nome_cliente text,                         -- desnormalizado: relatório legível
  data         date not null,
  hora         time,
  duracao_minutos integer default 45,

  status   text not null default 'agendada'
           check (status in ('agendada','realizada','cancelada','remarcada')),
  objetivo text check (objetivo in ('reativacao','cobranca','prospeccao','pos_venda','entrega')),

  observacoes text,
  resultado   jsonb,                         -- {compareceu, desfecho, valorCentavos, ...}

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists visitas_equipe_data_idx on public.visitas (equipe_id, data);
create index if not exists visitas_rep_idx        on public.visitas (representante_id, data);
create index if not exists visitas_cliente_idx    on public.visitas (cliente_id);

-- ---------------------------------------------------------------------
-- atualizado_em automático
-- ---------------------------------------------------------------------
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists clientes_atualizado on public.clientes;
create trigger clientes_atualizado before update on public.clientes
  for each row execute function public.tocar_atualizado_em();

drop trigger if exists visitas_atualizado on public.visitas;
create trigger visitas_atualizado before update on public.visitas
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- ultima_visita do cliente, mantida pelo banco
-- ---------------------------------------------------------------------
create or replace function public.atualizar_ultima_visita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'realizada' and new.cliente_id is not null then
    update public.clientes
       set ultima_visita = greatest(coalesce(ultima_visita, new.data), new.data)
     where id = new.cliente_id;
  end if;
  return new;
end;
$$;

drop trigger if exists visitas_marca_ultima on public.visitas;
create trigger visitas_marca_ultima after insert or update on public.visitas
  for each row execute function public.atualizar_ultima_visita();

-- =====================================================================
-- CRIAR A EQUIPE E CADASTRAR OS REPRESENTANTES
--
-- Os uuid saem de Authentication → Users no painel.
-- Ajuste os valores abaixo e rode.
-- =====================================================================

insert into public.equipes (nome)
select 'M A Joaquim Representação'
where not exists (select 1 from public.equipes);

-- Troque os uuid e e-mails pelos reais (Authentication -> Users).
insert into public.representantes (id, equipe_id, nome, email, codigo_sigma)
values
  ('00000000-0000-0000-0000-000000000001',
   (select id from public.equipes limit 1),
   '<nome do representante>', '<e-mail>', '25'),
  ('00000000-0000-0000-0000-000000000002',
   (select id from public.equipes limit 1),
   '<nome do representante>', '<e-mail>', '25')
on conflict (id) do update
  set equipe_id = excluded.equipe_id,
      nome      = excluded.nome,
      email     = excluded.email;

-- Conferência: os dois precisam aparecer, com a MESMA equipe_id.
select r.nome, r.email, r.ativo, e.nome as equipe
  from public.representantes r
  join public.equipes e on e.id = r.equipe_id;
