# 10 — Supabase: autenticação e dados

O Supabase é o **backend do portal**: banco Postgres, autenticação por e-mail e senha
e controle de acesso por linha (RLS). Substituiu o Google Apps Script — um backend em
vez de dois.

## O que o Supabase resolve (e o que não resolve)

| | |
|---|---|
| ✅ **Protege os dados** | Os 328 clientes vivem no Postgres, não no repositório nem no JavaScript. Sem token válido, ninguém lê nada. |
| ✅ **Login de verdade** | E-mail e senha, sessão persistente, revogável. |
| ✅ **Multi-representante** | Cada um enxerga só a própria carteira, garantido pelo banco. |
| ❌ **Não esconde o site** | O GitHub Pages continua público. Quem tiver a URL vê uma **tela de login** — e nada além disso. |

**Isso é o modelo certo.** É assim que funciona qualquer aplicação web: o site é
público, os dados não. A proteção deixa de ser "ninguém sabe a URL" e passa a ser
criptográfica.

**Consequência prática:** como nenhum dado de cliente fica no repositório, ele **pode
ser público** — e aí o GitHub Pages funciona no plano **Free**, sem os US$ 4/mês do Pro.
Em troca, o **RLS passa a ser a única fronteira de segurança** e precisa estar certo.

## Plano gratuito — limites reais

| Recurso | Free | Nosso uso |
|---|---|---|
| Banco | 500 MB | Catálogo + 328 clientes + visitas ≈ **menos de 5 MB** |
| Usuários ativos/mês | 50.000 | 1 a 5 |
| Egress | 5 GB/mês | Folgadíssimo |
| Armazenamento | 1 GB | Não usamos |

⚠️ **Projeto gratuito é pausado após 1 semana sem atividade.** Voltar exige despausar
pelo painel. Mitigação embutida: a rotina diária de sincronização de preços conta como
atividade e mantém o projeto vivo sozinho.

Plano Pro custa US$ 25/mês — só faz sentido se virar ferramenta de equipe.

## 🔑 Chaves: o que pode e o que não pode ir para o navegador

Este é **o** ponto onde projetos Supabase vazam dados.

| Chave | Vai no frontend? | Papel |
|---|---|---|
| **Publishable** (antiga `anon`) | ✅ **Sim, por design** | Identifica o app. Só enxerga o que o RLS permitir. |
| **Secret** (`service_role`) | 🔴 **NUNCA** | Ignora RLS por completo (`BYPASSRLS`). Acesso total. |

A chave publishable **é feita para ficar exposta** no código da página — segundo a
própria documentação, ela roda "em ambientes onde é impossível guardar segredo".
A segurança **não vem de escondê-la**; vem do RLS.

A chave secret vive **só** nos GitHub Secrets, usada pela rotina de sincronização.
Se ela vazar, alguém lê e escreve tudo. Trate como senha de banco.

## Esquema do banco

SQL completo em `modelos/supabase/01-schema.sql` e `02-rls.sql`.

```
equipes                                a unidade de compartilhamento
   │
   ├──< representantes  (id = auth.users.id)   perfil e allowlist
   │
   ├──< clientes   (equipe_id)   carteira COMPARTILHADA pela equipe
   │        │
   │        └──< visitas  (equipe_id, cliente_id)   agenda compartilhada
   │
catalogo   compartilhado — leitura para qualquer representante ativo
```

### Decisões de modelagem

- **`representantes.id` referencia `auth.users(id)`.** A tabela é, ao mesmo tempo,
  perfil e **allowlist**: quem não tem linha aqui não enxerga nada.
- **`equipe_id` controla a visibilidade; `representante_id`, a autoria.** Clientes e
  visitas pertencem à *equipe* — todos da equipe veem tudo. O `representante_id` fica
  em cada linha só para responder "quem agendou", "quem é o responsável" e alimentar
  relatório por pessoa. Separar os dois é o que permite compartilhar sem perder autoria.
- **`catalogo` é compartilhado.** Preço e saldo são os mesmos para todos. Escrita
  somente pela rotina de sincronização (`service_role`).
- **`status_estoque` é coluna gerada** pelo banco, não calculada no frontend:
  ```sql
  case when saldo is null then null
       when saldo < 6   then 'sem_estoque'
       when saldo < 200 then 'baixo'
       else 'ok' end
  ```
  Fonte única da verdade. Mudou o limiar? Uma migração, e todo mundo vê igual.
  (O caso `saldo = 6` cai em `baixo` — na planilha ele fica sem cor nenhuma, que é bug.)
- **`visitas.id` é `text`, gerado no cliente.** Essencial para a fila offline:
  reenviar a mesma visita faz *upsert*, nunca duplica.

## 🔒 RLS — a fronteira de segurança

**Toda tabela tem RLS ligado. Sem exceção.** Tabela sem RLS com a chave publishable
exposta é dado público.

### A armadilha que quase todo mundo cai

Qualquer conta criada no projeto — inclusive uma que você tenha criado para teste —
consegue um token `authenticated` válido. Se o catálogo tiver a política ingênua:

```sql
-- 🔴 ERRADO: qualquer conta autenticada lê preços e saldos
create policy "catalogo" on public.catalogo
  for select to authenticated using (true);
```

…então qualquer conta autenticada baixa sua tabela de preços inteira, com estoque —
mesmo sem estar cadastrada como representante.

A política correta exige ser **representante cadastrado e ativo**:

```sql
-- ✅ CERTO: só quem está na allowlist
create policy "catalogo: leitura de representante ativo" on public.catalogo
  for select to authenticated
  using (exists (
    select 1 from public.representantes r
    where r.id = auth.uid() and r.ativo
  ));
```

### Isolamento por equipe

```sql
create policy "clientes: da equipe" on public.clientes
  for all to authenticated
  using      (equipe_id = public.minha_equipe())    -- o que pode LER
  with check (equipe_id = public.minha_equipe());   -- o que pode GRAVAR
```

`minha_equipe()` devolve **NULL** para quem não é representante ativo. Como NULL nunca
casa em comparação, um estranho autenticado simplesmente não vê linha nenhuma — sem
precisar de `exists` espalhado por toda policy.

**`with check` não é opcional.** Sem ele, alguém pode *inserir* linha apontando para a
equipe de outra pessoa.

### Cadastrar um novo representante

Fluxo deliberadamente manual, porque é uma allowlist:

1. **Authentication → Users → Add user** → e-mail e senha.
2. Copie o `uuid` gerado.
3. Insira a linha em `representantes`.
4. Entregue a senha à pessoa por canal seguro; ela troca no primeiro acesso.

Antes do passo 3 a conta existe mas **não vê absolutamente nada** — é o esperado.

Para revogar: `update representantes set ativo = false`. O acesso morre na hora, sem
apagar a conta nem o histórico de visitas.

## Autenticação: e-mail e senha

**Decisão: e-mail + senha**, provedor nativo do Supabase. Zero configuração externa —
já vem ligado num projeto novo.

Por que não Google OAuth: exigiria criar credenciais no Google Cloud Console. É
gratuito para login, mas é uma dependência e um cadastro a mais, e o usuário preferiu
evitar. Em campo, senha salva no gerenciador do celular é tão rápida quanto — muitas
vezes mais, porque não abre navegador externo.

```js
import { createClient } from './vendor/supabase.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,        // sobrevive a fechar o navegador
    autoRefreshToken: true,      // renova sozinho; sem relogin no meio da visita
  },
});

export async function entrar(email, senha) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
}
```

Use `<input type="email" autocomplete="username">` e
`<input type="password" autocomplete="current-password">` — sem isso o gerenciador de
senhas do celular não oferece o preenchimento, e aí a senha vira atrito de verdade.

### Configuração no painel (uma vez)

1. **Authentication → Providers → Email**: já vem ativo.
2. **Desligue "Enable email signups"** (Authentication → Sign In / Providers).
   🔴 Isso é importante: com signup aberto, qualquer pessoa cria conta sozinha. Não
   seria catástrofe (o RLS não deixa ver nada sem estar em `representantes`), mas conta
   é superfície de ataque. Você cria os usuários pelo painel.
3. **Confirm email**: pode desligar, já que você cria as contas manualmente.

### Criar um usuário

**Authentication → Users → Add user** → e-mail e senha → copiar o `uuid` gerado →
inserir em `representantes`. Sem fluxo de OAuth, sem ovo-e-galinha: dá para fazer tudo
antes de o portal existir.

> **Trocar para Google depois custa quase nada.** O RLS usa `auth.uid()`, que é o mesmo
> qualquer que seja o provedor. Muda só a tela de login e a configuração do provider —
> as tabelas, as políticas e os dados ficam intactos.

## Offline: a sessão dura, os dados não

O token fica no `localStorage` — o usuário **continua logado sem rede**. Mas `fetch`
ao Supabase falha. Portanto a estratégia de cache continua valendo integralmente:

```
LEITURA   Supabase → IndexedDB (cache) → tela
          sem rede: serve o cache, com a data visível

ESCRITA   ação → IndexedDB (fila) → tela responde JÁ
          → sincroniza em segundo plano quando houver rede
```

⚠️ **Cuidado com o refresh token.** Sem rede por muito tempo, o token de acesso expira
e a renovação falha. Trate `AuthError` como "modo offline", **não** como "deslogar e
jogar o usuário na tela de login" — perder a fila de visitas por causa disso seria o
pior defeito possível do portal.

## Sincronização semanal de preços

Rotina automática: **GitHub Actions** lê o CSV publicado do Google Sheets e faz upsert
no `catalogo`. Workflow em `modelos/github-actions/sync-precos.yml`, script em
`ferramentas/sincronizar_supabase.py`.

Como a planilha muda toda semana e ninguém confere, o script tem **trava de sanidade**
e se recusa a sincronizar quando o dado parece errado:

| Verificação | Bloqueia se |
|---|---|
| Quantidade de itens | variou mais de 20% |
| Preço individual | variou mais de 50% |
| Itens sem preço | mais de 5% do total |
| Catálogo vazio | sempre |

Bloqueou → a Action falha, o GitHub manda e-mail, e o catálogo **anterior continua no
ar**. Muito melhor que subir preço errado em silêncio. É a rede de proteção que faltava
na opção automática.

Efeito colateral bom: a rotina diária conta como atividade e impede o Supabase gratuito
de pausar por inatividade.

## Testar o RLS antes de confiar

Não presuma que a política funciona porque o SQL rodou. **Teste como atacante:**

```bash
# 1. Sem token nenhum — deve vir vazio (nunca dados)
curl "$SUPABASE_URL/rest/v1/clientes" -H "apikey: $PUBLISHABLE_KEY"

# 2. Com token de um Google qualquer, fora da allowlist — deve vir vazio
curl "$SUPABASE_URL/rest/v1/catalogo" \
     -H "apikey: $PUBLISHABLE_KEY" -H "Authorization: Bearer $TOKEN_ESTRANHO"

# 3. Como representante A, tentar gravar para o representante B — deve ser recusado
```

Os três precisam falhar/vir vazios. Se o item 2 retornar o catálogo, a política está
com `using (true)` — corrija antes de publicar.

O painel do Supabase também acusa: **Database → Advisors** lista tabelas sem RLS.
Rode antes de cada publicação.

---

**Fontes:**
- [Supabase Pricing](https://supabase.com/pricing)
- [Understanding API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/api-keys)
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing your API — Supabase Docs](https://supabase.com/docs/guides/api/securing-your-api)
