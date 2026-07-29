# 02 — Arquitetura do portal

## A restrição que define tudo

**GitHub Pages serve arquivos estáticos. Não existe backend.** Nada de PHP, Node,
banco de dados ou sessão de servidor. Toda lógica roda no navegador do usuário.

Isso não é limitação — é o que torna o portal gratuito, rápido e praticamente
impossível de quebrar. Mas impõe três consequências que guiam cada decisão:

1. **Persistência precisa de um serviço externo** → **Supabase** (Postgres + Auth).
2. **Todo dado enviado ao navegador é visível ao usuário** → nada de segredo no código.
   A chave *publishable* do Supabase é exposta **por design**; quem protege é o RLS.
3. **O servidor não sabe quem está logado, mas o banco sabe.** O controle de acesso não
   está no GitHub Pages — está nas políticas de RLS do Supabase, avaliadas a cada
   consulta contra o token do usuário (ver `10-supabase-auth-e-dados.md`).

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Marcação | HTML5 semântico | — |
| Estilo | CSS moderno (Grid, Flexbox, variáveis, `clamp()`) | Sem framework: menos peso, zero atualização quebrando layout |
| Lógica | **JavaScript vanilla, ES modules** | Sem build. `<script type="module">` e pronto |
| Mapa | **Leaflet 1.9** + tiles OpenStreetMap | Gratuito, sem chave de API, leve (~40 KB) |
| Tabelas | Renderização própria com virtualização | 521 itens não precisam de biblioteca |
| PDF | `window.print()` + CSS `@media print` | Zero dependência, resultado nativo e fiel |
| Offline | Service Worker + **IndexedDB** | Funciona no campo sem sinal |
| **Dados e login** | **Supabase** (Postgres, RLS, Auth com Google) | Proteção real dos dados; grátis no nosso volume |
| Origem dos preços | Google Sheets → GitHub Actions → Supabase | O usuário atualiza a planilha; a rotina cuida do resto |

**Regra:** nenhuma biblioteca nova sem justificativa escrita. Cada dependência é uma
coisa a mais que pode quebrar num projeto mantido por uma pessoa só.

### Sobre bibliotecas externas e CDN

Leaflet é a única dependência de terceiros. **Baixe e versione localmente** em
`portal/assets/vendor/` — não use CDN. Motivos: funciona offline, não vaza o IP do
usuário para terceiros (LGPD) e não quebra se a CDN sair do ar.

## Estrutura de arquivos

```
portal/                        # ← é ISTO que vai para o GitHub Pages
├── index.html                 # casca do app + navegação entre abas
├── manifest.webmanifest       # PWA: instalável no celular
├── sw.js                      # Service Worker (cache offline)
├── robots.txt                 # bloqueia todos os robôs
├── assets/
│   ├── css/
│   │   ├── base.css           # reset, variáveis, tipografia
│   │   ├── componentes.css    # botões, tabelas, cards, campos
│   │   └── impressao.css      # @media print — o PDF do pedido
│   ├── vendor/leaflet/        # Leaflet local (não CDN)
│   └── icones/
├── js/
│   ├── app.js                 # bootstrap, roteamento por hash
│   ├── config.js              # URL + chave publishable do Supabase
│   ├── supabase.js            # cliente, sessão, login/logout
│   ├── nucleo/
│   │   ├── dados.js           # carregamento, cache IndexedDB
│   │   ├── moeda.js           # centavos, formatação BRL
│   │   ├── busca.js           # índice de busca com normalização
│   │   └── sincronizacao.js   # fila offline de escrita
│   ├── cotacoes/
│   │   ├── calculo.js         # regras de 03-motor-de-cotacoes.md
│   │   ├── tela.js            # interface
│   │   └── exportar.js        # PDF/link + sanitização
│   ├── carteira/
│   ├── mapa/
│   └── agenda/
└── (sem pasta dados/ — nenhum dado de negócio no repositório)
```

`config.js` guarda a URL do projeto e a chave **publishable** do Supabase. Ambas são
públicas por design — não são segredo, e o RLS é que protege. A chave **secret** nunca
aparece aqui.

## Fluxo de dados

```
┌─ ORIGEM DOS PREÇOS (fora do portal, 1×/dia) ─────────────────────┐
│  Google Sheets ──CSV──> GitHub Actions ──service_role──> Supabase│
│                          (valida e trava)                        │
└──────────────────────────────────────────────────────────────────┘

┌─ LEITURA (no portal) ────────────────────────────────────────────┐
│  login com Google ──> token JWT                                  │
│         │                                                        │
│         ▼                                                        │
│   Supabase (RLS avalia o token a cada consulta)                  │
│         │                                                        │
│         ▼                                                        │
│   IndexedDB (cache datado) ──> estado da aplicação ──> tela      │
│         └─ sem rede: serve o cache, com a data visível           │
└──────────────────────────────────────────────────────────────────┘

┌─ ESCRITA (agenda, contatos, notas) ──────────────────────────────┐
│  ação do usuário                                                 │
│      ▼                                                           │
│  fila em IndexedDB ──────> Supabase (upsert por id)              │
│      └─ offline: fica na fila, ícone "pendente",                 │
│         reenvia sozinho quando a rede voltar                     │
└──────────────────────────────────────────────────────────────────┘
```

### Estratégia de carregamento (ordem exata)

1. Verifica a sessão. Sem sessão → tela de login, e só.
2. Renderiza a casca com o que está no **IndexedDB** — tela útil em <100 ms.
3. Consulta o Supabase em paralelo.
4. Chegou → atualiza a tela, grava no cache, marca a data.
5. Falhou → mantém o cache e mostra: *"Dados de DD/MM às HH:MM — sem conexão."*
6. Cache vazio **e** rede falhou → estado vazio explicando o porquê. **Não existe mais
   snapshot versionado**: dado de cliente não entra no repositório.

**Nunca deixe a tela em branco sem explicação.** Sempre há um dado ou um motivo, e o
dado sempre está datado.

⚠️ **Falha de autenticação offline não é logout.** Sem rede, a renovação do token
falha. Trate como modo offline e siga servindo o cache — jogar o usuário na tela de
login no meio de uma visita, com a fila cheia, seria o pior defeito possível.

## Modelo de dados

Contratos completos em `dados/schema/`. Resumo:

```js
// catalogo.json
{
  "versao": "2026-07-27",
  "atualizadoEm": "2026-07-27T10:00:00-03:00",
  "itens": [{
    "codigoSigma": "SGU-1828A-S",     // CHAVE PRIMÁRIA — única (521/521)
    "codigoFabricante": "DC64-01827A", // OEM — tem duplicata, NÃO é chave
    "descricao": "GUARNIÇÃO DA PORTA LAVA E SECA",
    "valorUnitarioCentavos": 8140,     // inteiro, sempre
    "ipi": 0.052,                      // 4 casas, já arredondado
    "st": false,                       // só selo visual — não é calculado
    "categoria": "Lava e seca",        // informativo — comissão não é calculada
    "grupo": "001-GUARNICOES",         // null se não estiver no catálogo lateral
    "saldo": 3540,                     // null se desconhecido
    // 🚦 semáforo: 'sem_estoque' (<6) | 'baixo' (<200) | 'ok' | null
    "statusEstoque": "ok"
  }],
  "comissoes": { "Lava e seca": 0.05, "Refrigerador": 0.04, "...": 0 }
}

// clientes.json
{
  "clientes": [{
    "codigo": "21152",
    "nome": "REFRIRIO COMERCIO DE PECAS LTDA",  // sufixo [código] removido
    "origem": "inativo",              // "inativo" | "recuperacao"
    "status": "Sem Título",           // "Sem Título" | "Com Título" | "Atrasado"
    "telefone": "(21) 3000-0000",
    "email": "financeiro@exemplo.com.br",
    "endereco": {
      "logradouro": "AVENIDA OLOF PALME",  // sem número na origem
      "bairro": "CAMORIM",
      "cidade": "Rio de Janeiro",     // normalizada
      "uf": "RJ",
      "cep": "20000-000"
    },
    "geo": { "lat": -22.97, "lng": -43.42, "precisao": "cep" }  // null se falhou
  }]
}
```

### Convenções invioláveis

- **Dinheiro:** sempre inteiro em centavos, sufixo `Centavos` no nome do campo.
- **Percentual:** sempre decimal (`0.05`), nunca `5`. Formate como % só na exibição.
- **Datas:** ISO 8601 com fuso (`-03:00`). Nunca `DD/MM/AAAA` em dado, só na tela.
- **Ausência:** `null` explícito. **Nunca** `0`, `""` ou `"N/A"` para "não sei".
- **Chave de cliente:** `codigo`. Chave de item: `codigoSigma`.

## Performance

- 521 itens + 328 clientes ≈ **250 KB de JSON**. Cabe na memória, sem paginação.
- **Índice de busca pré-calculado** no carregamento: normalize acento e caixa uma vez,
  não a cada tecla.
- **Virtualize** listas acima de ~100 linhas visíveis (renderize só o que está na tela).
- **Debounce** de 120 ms na busca; `requestAnimationFrame` para atualizar totais.
- Meta: interação em **< 50 ms** num celular mediano. É ferramenta de trabalho, não site.

## Roteamento

Hash routing (`#/cotacoes`, `#/carteira`, `#/mapa`, `#/agenda`) — GitHub Pages não faz
rewrite de servidor, então History API daria 404 ao recarregar. Hash sempre funciona.

## Tratamento de erro

A planilha muda toda semana. **O portal precisa quebrar com dignidade:**

```js
// Valide o schema no carregamento. Falhe alto, nunca em silêncio.
function validarCatalogo(dados) {
  const problemas = [];
  if (!Array.isArray(dados.itens) || !dados.itens.length)
    problemas.push('Catálogo vazio ou em formato inesperado.');

  dados.itens.forEach((item, i) => {
    if (!item.codigoSigma)
      problemas.push(`Linha ${i + 2}: sem Código Sigma.`);
    if (!Number.isInteger(item.valorUnitarioCentavos))
      problemas.push(`${item.codigoSigma}: preço ausente ou inválido.`);
    if (item.categoria && !(item.categoria in dados.comissoes))
      problemas.push(`${item.codigoSigma}: categoria "${item.categoria}" sem comissão.`);
  });

  const duplicados = encontrarDuplicados(dados.itens.map(i => i.codigoSigma));
  if (duplicados.length)
    problemas.push(`Código Sigma duplicado: ${duplicados.join(', ')}`);

  return problemas;
}
```

Havendo problemas: mostre um painel **"⚠️ N inconsistências na tabela"**, expansível,
com a linha e o motivo. O portal continua funcionando com os itens válidos — mas o
usuário sabe exatamente o que ignorar. Isso é o oposto do `#N/A` silencioso do Excel.
