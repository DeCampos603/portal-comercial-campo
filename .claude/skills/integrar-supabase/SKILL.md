---
name: integrar-supabase
description: Configura o Supabase como backend do portal — banco, login por e-mail e senha, políticas de Row Level Security e a sincronização automática de preços do Google Sheets. Use quando o usuário pedir para configurar o Supabase, o login, o banco de dados, as permissões, a sincronização de preços, ou quando a autenticação ou o acesso pararem de funcionar.
---

# Integrar com Supabase

O Supabase é o backend do portal: Postgres, login por e-mail e senha, e controle de
acesso por linha. Leia `conhecimento/10-supabase-auth-e-dados.md` antes de começar.

**Entenda o que está sendo protegido:** o site continua público (quem tiver a URL vê a
tela de login). O que fica protegido são os **dados** — os 328 clientes vivem no
Postgres atrás de RLS, nunca no repositório nem no JavaScript.

## Passo 1 — Criar o projeto

1. [supabase.com](https://supabase.com) → New project. Região: **South America (São Paulo)**.
2. Guarde a senha do banco.
3. Em **Settings → API**, anote:
   - `Project URL` e a chave **publishable** (antiga `anon`) → vão para `portal/js/config.js`
   - A chave **secret** (`service_role`) → **só** nos GitHub Secrets

🔴 **A chave secret ignora RLS por completo.** Nunca no frontend, nunca commitada.

## Passo 2 — Criar o esquema

No **SQL Editor**, rode em ordem:

```
modelos/supabase/01-schema.sql    tabelas, índices, triggers
modelos/supabase/02-rls.sql       políticas de segurança
```

O `02-rls.sql` termina com duas consultas de conferência. **Leia a saída:**
- Toda tabela em `public` precisa ter `rowsecurity = true`
- Nenhuma policy pode ter `qual = true` sem qualificação

## Passo 3 — Login por e-mail e senha

Nenhuma configuração externa: o provedor de e-mail já vem ativo num projeto novo.

Em **Authentication → Sign In / Providers → Email**:
1. Confirme que **Email** está ativo.
2. 🔴 **Desligue "Enable email signups".** Com signup aberto, qualquer pessoa cria
   conta sozinha. O RLS impede que ela veja algo, mas conta é superfície de ataque —
   e você cria os usuários pelo painel.
3. **Confirm email**: pode desligar, já que as contas são criadas manualmente.

## Passo 4 — Cadastrar você como representante

O cadastro é **manual de propósito** — a tabela `representantes` é a allowlist.

1. **Authentication → Users → Add user** → e-mail e senha.
2. Copie o `uuid` gerado.
3. No SQL Editor — aponte para a **mesma equipe** se a pessoa deve ver a mesma carteira:

```sql
insert into public.representantes (id, equipe_id, nome, email, codigo_sigma)
values ('<uuid>', (select id from public.equipes limit 1),
        '<nome>', '<e-mail>', '25');
```

Antes do passo 3 a conta existe mas **não vê nada** — é o esperado.
Dá para fazer tudo isso antes de o portal existir.

Para adicionar outro representante depois, é o mesmo fluxo. Para revogar:
`update public.representantes set ativo = false where id = '<uuid>';`

## Passo 5 — Carga inicial dos dados

Credenciais num `.env` na raiz (copie de `modelos/.env.exemplo`). Ele é ignorado pelo
git — **nunca** cole essas chaves em chat, e-mail ou issue.

```bash
# 1. Gerar os JSON a partir das planilhas (se ainda não existirem)
python ferramentas/importar_precos.py "<xlsx>" --saida dados/privado/catalogo.json
python ferramentas/importar_clientes.py --inativos "<a.xlsx>" --recuperacao "<b.xlsx>" \
    --saida dados/privado/clientes.json

# 2. Geocodificar (~6 min; exige preencher CONTATO no script)
python ferramentas/geocodificar.py dados/privado/clientes.json

# 3. Conferir sem gravar, depois enviar
python ferramentas/carga_inicial.py --simular
python ferramentas/carga_inicial.py
```

A carga é **upsert** — pode repetir sem duplicar. Se geocodificar depois, basta rodar
`carga_inicial.py` de novo para preencher as coordenadas.

## Passo 6 — Sincronização automática de preços

1. Prepare a aba `Precos` e publique como CSV (`conhecimento/07-google-sheets-precos.md`).
2. Copie `modelos/github-actions/sync-precos.yml` para `.github/workflows/`.
3. Em **Settings → Secrets and variables → Actions**, crie:
   `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SHEETS_CSV_URL`
4. Teste primeiro em modo simulação:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SHEETS_CSV_URL=... \
  python ferramentas/sincronizar_supabase.py --simular
```

5. Depois rode o workflow na mão (**Actions → Sincronizar preços → Run workflow**).

> A execução diária mantém o projeto Supabase gratuito ativo — ele é pausado após
> 1 semana de inatividade.

## Passo 7 — 🔴 Testar o RLS como atacante

**Não presuma que funciona porque o SQL rodou sem erro.**

```bash
python ferramentas/testar_rls.py
```

O script roda quatro testes e **cria e apaga a conta atacante sozinho** (usa a
`service_role` para isso). Sai com código 1 se algo falhar.

| Teste | O que verifica |
|---|---|
| 1 | Visitante sem login → 0 linhas em todas as tabelas |
| 2 | Conta autenticada **fora** da allowlist → 0 linhas, inclusive catálogo |
| 3 | Escrita anônima → recusada |
| 4 | **Caminho feliz**: representante cadastrado **enxerga** os dados |

O teste 4 não é enfeite: um RLS que bloqueia todo mundo passaria nos três primeiros e
ainda assim estaria quebrado. Segurança que impede o dono de trabalhar é bug, não zelo.

Rode também **Database → Advisors** no painel: ele lista tabela sem RLS.

Se o catálogo aparecer para um estranho, **corrija antes de publicar** — senão qualquer
conta autenticada baixa sua tabela de preços com os saldos de estoque.

## Diagnóstico

| Sintoma | Causa provável |
|---|---|
| "Invalid login credentials" | Senha errada, ou o usuário não existe em Authentication → Users |
| Logou mas não vê nada | Falta a linha em `representantes`, ou `ativo = false` |
| `401` / `permission denied` | RLS sem policy para a operação, ou `with check` barrando |
| Conta de teste lê o catálogo | Policy com `using (true)` — trocar por `eh_representante_ativo()` |
| Escrita some sem erro | RLS filtrou pelo `with check`; confira o `representante_id` enviado |
| Projeto fora do ar | Pausado por inatividade — despause no painel |
| Deslogou sozinho no campo | Tratar falha de refresh como **offline**, não como logout |
| Sync falhou | Trava de sanidade agiu. Leia o log: o catálogo anterior continua no ar |
