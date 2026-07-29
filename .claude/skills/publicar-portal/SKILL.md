---
name: publicar-portal
description: Publica o portal no GitHub Pages e roda a checklist completa de segurança, RLS, privacidade e LGPD antes de colocar no ar. Use quando o usuário pedir para publicar, subir o site, colocar no ar, hospedar, configurar o GitHub Pages ou revisar a segurança antes de publicar.
---

# Publicar o portal

⚠️ **Este portal dá acesso a 328 clientes reais com contato e situação financeira.**
A checklist não é burocracia — é o que impede vazamento de dado de terceiros.

Leia `conhecimento/09-publicacao-e-seguranca.md` e `10-supabase-auth-e-dados.md` antes.

## O modelo de segurança

**O site é público. Os dados não.** Quem abrir a URL vê uma tela de login. Os dados
vivem no Supabase, atrás de RLS.

Isso significa que **o RLS é a única fronteira de segurança**. Se ele estiver errado, o
site estar "escondido" não salva nada. Por isso o Passo 1 é testar o RLS — antes de
qualquer outra coisa.

## Passo 1 — 🔴 Testar o RLS como atacante (bloqueante)

**Não publique sem fazer isto.** Não confie em "o SQL rodou sem erro".

```bash
python ferramentas/testar_rls.py
```

Ele cria e apaga a conta atacante sozinho, e roda quatro verificações:

| Teste | O que verifica |
|---|---|
| 1 | Visitante sem login → 0 linhas em todas as tabelas |
| 2 | Conta autenticada **fora** da allowlist → 0 linhas, inclusive catálogo |
| 3 | Escrita anônima → recusada |
| 4 | **Caminho feliz**: representante cadastrado **enxerga** os dados |

O teste 4 é tão importante quanto os outros: um RLS que bloqueia todo mundo passaria nos
três primeiros e ainda assim estaria quebrado.

No painel: **Database → Advisors** não pode acusar tabela sem RLS.

Qualquer falha → **pare e corrija**. Um estranho baixando sua tabela de preços com
saldos, ou a carteira de clientes, é exatamente o cenário a evitar.

## Passo 2 — Auditar o que vai subir

```bash
git status
git ls-files | grep -Ei '\.(xlsx|xls|csv)$'      # precisa vir VAZIO
```

Confirme:
- Nenhuma planilha versionada
- **Não existe** `portal/dados/clientes.json` nem equivalente
- `dados/privado/` e `cache/` ignorados
- Em `portal/js/config.js`, **só** a chave publishable — nunca a secret
- A chave secret está apenas nos GitHub Secrets

> Arquivo comitado por engano fica no histórico do Git **para sempre**.

## Passo 3 — Repositório público ou privado?

Pergunte ao usuário. As duas são defensáveis agora:

| | Público | Privado |
|---|---|---|
| Custo | **Grátis** | GitHub Pro (~US$ 4/mês) |
| Expõe | Código, URL do Supabase e chave publishable — **públicos por design** | Nada |
| Segurança dos dados | Idêntica (RLS) | Idêntica (RLS) |

Público é aceitável e economiza. Privado é defesa em profundidade. **O que não muda:
o RLS precisa estar certo nos dois casos.**

## Passo 4 — Blindar contra buscadores

Mesmo com login, mantenha — não custa nada.

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

## Passo 5 — Checklist completa

```
SUPABASE  🔴 a parte que realmente protege
[ ] RLS ligado em TODAS as tabelas (Advisors limpo)
[ ] Nenhuma policy com `using (true)` sem qualificação
[ ] Policies de escrita têm `with check`, não só `using`
[ ] Os 3 testes do Passo 1 passaram

DADOS
[ ] git ls-files não lista planilha nem dado de cliente
[ ] Só a chave publishable no frontend
[ ] Secret apenas nos GitHub Secrets

FRONTEND
[ ] robots.txt + noindex
[ ] Zero analytics / rastreador
[ ] Leaflet local, fonte do sistema
[ ] CSP e referrer configurados
[ ] Caminhos RELATIVOS (./) — Pages serve em subdiretório
[ ] Service Worker com escopo relativo

FUNCIONAL
[ ] PDF do cliente sem comissão, saldo ou categoria (buscar no arquivo gerado)
[ ] Funciona em modo avião com o cache
[ ] Falha de refresh de token NÃO desloga o usuário
[ ] Testado no celular
```

## Passo 6 — Publicar

```bash
git init
git add .
git commit -m "Portal Comercial de Campo — versão inicial"
git branch -M main
git remote add origin https://github.com/<usuario>/<repo>.git
git push -u origin main
```

**Settings → Pages**: *Source* = `Deploy from a branch`, branch `main`, pasta `/portal`.

> ⚠️ Se `/portal` não aparecer (o GitHub às vezes só oferece `/` e `/docs`), renomeie
> `portal/` para `docs/`.

## Passo 7 — Cadastrar a Site URL

Com a URL final em mãos (`https://<usuario>.github.io/<repo>/`), cadastre em
Supabase → **Authentication → URL Configuration → Site URL**, com a subpasta e a
barra final.

Com login por e-mail e senha não há redirecionamento externo, então isso não quebra o
login — mas é a URL usada nos e-mails de recuperação de senha. Sem ela, o link de
redefinição aponta para `localhost`.

## Passo 8 — Verificar no ar

```
[ ] Abre em janela anônima e mostra a TELA DE LOGIN (não os dados)
[ ] Login com e-mail e senha entra no portal
[ ] Catálogo e carteira carregam depois do login
[ ] Mapa renderiza os 328 pinos
[ ] Agendar uma visita e conferir a linha na tabela `visitas`
[ ] PWA instala no celular
[ ] Modo avião: continua funcionando com o cache
[ ] Gerar PDF de cliente e procurar por "comiss" e "saldo" no arquivo → nada
```

O primeiro item é o mais importante: **em janela anônima não pode aparecer nenhum dado.**

## Se algo vazar

1. `update public.representantes set ativo = false where id = '<uuid>'` — corta na hora.
2. Rotacionar as chaves no Supabase (Settings → API) e atualizar os GitHub Secrets.
3. Se a **secret** vazou: rotacione imediatamente e audite os logs do banco.
4. Dado comitado: reescrever histórico (`git filter-repo`), e considerar que já pode ter
   sido copiado.
5. Avaliar comunicação aos titulares, conforme a extensão.
