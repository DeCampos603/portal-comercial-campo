-- =====================================================================
-- RESET — apaga tudo e permite recriar do zero.
--
-- 🔴 DESTRUTIVO. Só rode enquanto o banco ainda NÃO tem dados de verdade.
--    Depois da carga inicial, use migrações em vez disto.
--
-- Não mexe em auth.users: suas contas de login continuam intactas.
-- =====================================================================

drop table if exists public.visitas        cascade;
drop table if exists public.clientes       cascade;
drop table if exists public.catalogo       cascade;
drop table if exists public.representantes cascade;
drop table if exists public.equipes        cascade;

drop function if exists public.eh_representante_ativo()  cascade;
drop function if exists public.minha_equipe()            cascade;
drop function if exists public.tocar_atualizado_em()     cascade;
drop function if exists public.atualizar_ultima_visita() cascade;

-- Depois deste arquivo, rode 01-schema.sql e 02-rls.sql.
