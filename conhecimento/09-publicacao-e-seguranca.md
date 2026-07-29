# 09 — Publicação e segurança

## O modelo de segurança, em uma frase

**O site é público. Os dados não.**

Quem abrir a URL vê uma **tela de login** e mais nada. Os 328 clientes vivem no Postgres
do Supabase, atrás de Row Level Security — nunca no repositório, nunca no JavaScript.

É assim que funciona qualquer aplicação web séria. A proteção deixou de ser "ninguém
sabe o endereço" e passou a ser criptográfica.

## O que mudou com o Supabase

| Antes (plano descartado) | Agora |
|---|---|
| Dados em JSON no repositório | Dados no Postgres, atrás de RLS |
| Proteção = URL não divulgada | Proteção = autenticação + RLS |
| Repositório **precisava** ser privado | Repositório **pode** ser público |
| Exigia GitHub Pro (~US$ 4/mês) | Funciona no plano **Free** |
| Qualquer um com a URL via tudo | Sem login, não há dado nenhum |

**Consequência importante:** como o repositório não guarda mais dado de negócio, a
exigência do GitHub Pro cai. Em troca, **o RLS passa a ser a única fronteira de
segurança** — e precisa ser testado, não presumido.

### Repositório público ou privado?

Público é aceitável e economiza os US$ 4/mês. O que ficaria visível: o código, a URL do
projeto Supabase e a chave *publishable* — todos **públicos por design**.

Privado continua sendo boa prática (defesa em profundidade, não expõe a estrutura da
aplicação a quem quer sondar), mas aí volta o custo do Pro. **Decisão do usuário; as
duas são defensáveis.** O que não muda: o RLS precisa estar certo nos dois casos.

## 🔴 As três regras que não se quebram

### 1. Nenhum dado de cliente no repositório

Não existe mais `portal/dados/clientes.json`. O `.gitignore` bloqueia `*.xlsx` e
`dados/privado/`, mas **confira antes de cada commit**:

```bash
git status
git ls-files | grep -Ei '\.(xlsx|xls|csv)$'     # precisa vir VAZIO
```

Arquivo comitado por engano fica no histórico do Git **para sempre**, mesmo depois de
apagado.

### 2. A chave secret nunca sai dos GitHub Secrets

| Chave | Onde vive | Se vazar |
|---|---|---|
| **publishable** (`anon`) | `portal/js/config.js`, no navegador | Nada — o RLS protege |
| **secret** (`service_role`) | Só nos GitHub Secrets | 🔴 Acesso total, ignora RLS |

### 3. RLS ligado em toda tabela, com policy qualificada

A armadilha: **qualquer conta criada no projeto** obtém um token `authenticated`
válido — inclusive uma de teste. Policy com `using (true)` entrega os dados a ela.
"Estar logado" não é permissão: a policy precisa exigir estar em `representantes` e
ativo. Detalhes e a política correta em `10-supabase-auth-e-dados.md`.

## Ainda vale bloquear indexação

Mesmo com login, mantenha — não custa nada e evita que a URL apareça em busca.

`portal/robots.txt`:
```
User-agent: *
Disallow: /
```

Em toda página HTML:
```html
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
<meta name="referrer" content="no-referrer">
```

## Sem terceiros recebendo dados

- ❌ Google Analytics, Meta Pixel, Hotjar e afins.
- ❌ Google Fonts (envia o IP do usuário ao Google) → **fonte do sistema**.
- ❌ CDN de biblioteca → **Leaflet local**, versionado.
- ✅ Conexões externas legítimas: tiles do OpenStreetMap e Supabase. Só isso.

### CSP

GitHub Pages não permite cabeçalhos HTTP, mas dá para usar `<meta>`:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               img-src 'self' data: https://*.tile.openstreetmap.org;
               connect-src 'self' https://*.supabase.co wss://*.supabase.co;
               style-src 'self' 'unsafe-inline';
               script-src 'self';
               frame-ancestors 'none';">
```

`connect-src` precisa incluir `wss://` se um dia usar realtime do Supabase.

## Checklist antes de publicar

```
DADOS
[ ] git ls-files não lista planilha nem dado de cliente
[ ] Não existe portal/dados/clientes.json (nem equivalente)
[ ] dados/privado/ e cache/ ignorados
[ ] Nenhuma chave secret no código ou no histórico

SUPABASE  🔴 a parte que realmente protege
[ ] RLS ligado em TODAS as tabelas (Database → Advisors não acusa nada)
[ ] Nenhuma policy com `using (true)` sem qualificação
[ ] Policies de escrita têm `with check`, não só `using`
[ ] Testado sem token          → vem vazio
[ ] Testado com conta fora da allowlist → vem vazio, INCLUSIVE o catálogo
[ ] Testado gravar com representante_id alheio → recusado

FRONTEND
[ ] Só a chave publishable em config.js
[ ] robots.txt + noindex
[ ] Zero analytics / rastreador
[ ] Leaflet local, fonte do sistema
[ ] CSP e referrer configurados
[ ] Caminhos RELATIVOS (./) — Pages serve em subdiretório
[ ] Site URL cadastrada no Supabase bate com a URL real do Pages

FUNCIONAL
[ ] PDF do cliente sem comissão, saldo, categoria ou custo (buscar no arquivo gerado)
[ ] Funciona em modo avião com o cache
[ ] Falha de refresh de token NÃO desloga o usuário
[ ] Testado no celular
```

## Publicando

```bash
git init
git add .
git commit -m "Portal Comercial de Campo — versão inicial"
git branch -M main
git remote add origin https://github.com/<usuario>/<repo>.git
git push -u origin main
```

**Settings → Pages**: *Source* = `Deploy from a branch`, branch `main`, pasta `/portal`
— publicar a subpasta evita expor `conhecimento/`, `ferramentas/` e `modelos/`.

> ⚠️ Se `/portal` não aparecer (o GitHub às vezes só oferece `/` e `/docs`), renomeie
> `portal/` para `docs/`. Mais simples que montar um workflow só para isso.

Depois, cadastre a URL final em *Authentication → URL Configuration → Site URL* no
Supabase. Com login por e-mail e senha não há redirecionamento externo, mas a Site URL
é usada nos e-mails de recuperação de senha.

## LGPD

Os dados são de pessoas jurídicas, mas contêm dado pessoal (e-mail nominal, telefone) e
informação sobre situação financeira.

| Princípio | Como cumprimos |
|---|---|
| **Finalidade** | Uso restrito à representação comercial. Não repassar. |
| **Necessidade** | Só os campos usados. Não acumular "porque pode servir". |
| **Segurança** | Autenticação real, RLS, sem terceiros, TLS ponta a ponta. |
| **Transparência** | Saber responder que dados existem, se um cliente perguntar. |
| **Retenção** | Cliente que pedir remoção sai do banco — inclusive das coordenadas. |
| **Rastreabilidade** | `atualizado_em` em clientes e visitas. |

O Supabase melhora bastante essa posição: dado em repouso criptografado, acesso
autenticado e revogável (`ativo = false`), e trilha de alteração.

## Se algo vazar

1. **Revogar acesso:** `update representantes set ativo = false where id = '<uuid>'`.
2. **Rotacionar chaves** no painel do Supabase (Settings → API) e atualizar os Secrets.
3. **Se a chave secret vazou:** rotacione imediatamente e audite os logs do banco.
4. **Se dado foi comitado:** reescrever histórico (`git filter-repo`) e considerar que
   já pode ter sido copiado.
5. Avaliar comunicação aos titulares, conforme a extensão.

---

**Fontes:**
- [What is GitHub Pages? — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub's plans — GitHub Docs](https://docs.github.com/get-started/learning-about-github/githubs-products)
- [Securing your API — Supabase Docs](https://supabase.com/docs/guides/api/securing-your-api)
