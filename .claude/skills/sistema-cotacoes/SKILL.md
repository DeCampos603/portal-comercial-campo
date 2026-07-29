---
name: sistema-cotacoes
description: Constrói ou evolui o módulo de cotações do portal — busca de itens, cálculo de IPI e comissão, totais, e exportação do pedido em PDF ou link para o cliente. Use quando o usuário pedir para criar, ajustar ou corrigir a calculadora de cotações, o orçamento, o pedido, ou a exportação para o cliente.
---

# Sistema de cotações

O módulo mais crítico do portal. **Um erro de cálculo aqui vira prejuízo real.**

## Antes de começar

Leia `conhecimento/03-motor-de-cotacoes.md` inteiro — é a especificação, com atenção
especial à seção **"Semáforo de estoque"**. Depois, **leia `PENDENCIAS.md`**.

**Escopo definido pelo usuário:** o portal **não calcula comissão nem ST**. Só IPI.
Em compensação, o **semáforo de estoque é requisito de primeira ordem** — as linhas
vermelhas e amarelas da planilha são a informação que evita cotar peça inexistente.

## Ordem de construção

Construa nesta sequência. Cada etapa é testável sozinha.

### 1. Núcleo de cálculo (`js/cotacoes/calculo.js`)

**Funções puras, sem DOM.** É o que dá para testar de verdade.

```js
export function calcularLinha(item, quantidade) { … }
export function calcularTotais(linhas) { … }
export function classificarEstoque(saldo) { … }
```

Regras que não se negociam:
- Aritmética em **centavos inteiros**.
- Arredonde o IPI **uma vez**, na linha — nunca acumule fração.
- Preço ausente → `null`, **nunca `0`**.
- Totais somam **todas** as linhas (o bug 1 da planilha não se repete).
- Limiares de estoque como **constantes nomeadas** (`SALDO_SEM_ESTOQUE = 6`,
  `SALDO_BAIXO = 200`) — mudam quando a Sigma mudar a regra.

**Teste com casos reais antes de seguir:**

| Item | Qtd | Unit. | IPI | Esperado |
|---|---:|---:|---:|---|
| `SGU-1828A-S` | 3 | 81,40 | 5,2% | Produtos 244,20 · c/ IPI 256,90 |
| `SVA-92103-X` | 1 | 64,50 | 0% | Precisa entrar no total (item 521 — o Excel perde) |
| `SGU-16502-G` | 1 | — | — | Saldo 0 → 🔴 `sem_estoque` |
| `SCT-00952-W` | 1 | — | — | Saldo 6 → 🟡 `baixo` (na planilha fica **sem cor**) |
| `SGU-3199A-S` | 1 | — | — | Saldo 190 → 🟡 `baixo` |
| `SGU-1828A-S` | 1 | — | — | Saldo 3540 → 🟢 `ok` |

### 2. Índice de busca (`js/nucleo/busca.js`)

521 itens, busca a cada tecla. Normalize **uma vez**, no carregamento:

```js
const normalizar = (t) => String(t ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
  .toUpperCase().trim();

// Índice pré-calculado: código Sigma + código OEM + descrição num campo só.
const indice = itens.map(i => ({
  item: i,
  busca: normalizar(`${i.codigoSigma} ${i.codigoFabricante} ${i.descricao}`),
}));
```

Ordene os resultados por relevância: código exato > código começa com > descrição contém.
Quem digita `SGU-1828` quer aquele item em primeiro, não o 40º da lista.

### 3. Interface (`js/cotacoes/tela.js`)

Fluxo de teclado (o ganho real de produtividade — ver `conhecimento/08`):

```
[busca] --Enter--> adiciona item --foco--> [qtd] --Enter--> volta para [busca]
```

Elementos obrigatórios:
- Busca em destaque, foco automático ao abrir, atalho `/`
- **🚦 Semáforo nos resultados da BUSCA** — o selo tem que aparecer *antes* de escolher
  o item, junto do saldo real (`🔴 Saldo: 3`), senão a peça errada já entrou na cotação
- Filtro **"só com estoque"** na busca
- Tabela: código · descrição · qtd · unit. · IPI · total · **estoque** · [remover]
- Alerta quando a **quantidade pedida excede o saldo** (`pediu 50, há 12`)
- Selo **ST** nos 11 itens marcados (só visual, sem cálculo)
- Rodapé fixo: Total Produtos · Total c/ IPI · **"⚠️ N itens sem estoque"**
- Seletor de cliente que **preenche o cabeçalho inteiro** pela carteira

### 4. Rascunho automático

```js
// A cada mudança. Fechar a aba sem querer não pode custar 20 minutos.
localStorage.setItem('cotacao_rascunho', JSON.stringify(estado));
```

Ao abrir com rascunho salvo: *"Você tem uma cotação em andamento de 25/07 com 12 itens.
[Continuar] [Descartar]"*.

### 5. Exportação (`js/cotacoes/exportar.js`)

**Dois modos, e não confunda os dois:**

| Modo | Contém | Para |
|---|---|---|
| Interno | Tudo — comissão, saldo, categoria | O usuário |
| **Cliente** | **Só** o formato do pedido Sigma | O cliente |

```js
const cotacaoCliente = sanitizarParaCliente(cotacao);   // conhecimento/03
```

Rode o filtro na **geração do artefato**, não no CSS. Se o dado não entra no HTML,
nenhum "inspecionar elemento" o encontra. O `display:none` da folha de impressão é a
**segunda** barreira, não a primeira.

O PDF sai via `window.print()` com `@media print`, no layout do pedido Sigma:
cabeçalho (cliente, CNPJ, endereço, contato) · itens · totais · condições de pagamento ·
observações · campos de aprovação.

## Checklist antes de dar por pronto

```
CÁLCULO
[ ] Todos os 521 itens entram no total (inclusive 520 e 521)
[ ] Preço ausente mostra "—", não R$ 0,00
[ ] Nenhum 0.30000000000000004 na tela
[ ] Total confere com o Excel numa cotação real de 10+ itens

ESTOQUE (requisito de negócio nº 1)
[ ] 69 itens marcados 🔴 · 111 🟡 · 331 🟢 · 10 sem dado
[ ] Selo aparece nos resultados da BUSCA, com o saldo real
[ ] SCT-00952-W (saldo 6) aparece 🟡 — na planilha ele fica sem cor
[ ] Quantidade acima do saldo dispara alerta
[ ] Exportar com item 🔴 pede confirmação
[ ] Filtro "só com estoque" funciona

INTERFACE
[ ] Busca responde em <50 ms com 521 itens
[ ] Pedido de 15 itens montado só com teclado
[ ] Rascunho sobrevive a fechar e reabrir a aba

EXPORTAÇÃO
[ ] PDF do cliente NÃO tem saldo nem statusEstoque (conferir no HTML gerado)
[ ] PDF do cliente NÃO tem comissão nem categoria
[ ] Cabeçalho preenchido pela carteira, sem digitação
[ ] Impressão em A4 com cabeçalho repetido em todas as páginas
```

O teste do PDF é o mais importante: **gere um pedido real, salve como PDF, abra e
procure por "comiss" e por "saldo"**. Não confie na inspeção visual — o cliente não
pode saber quanto existe em estoque.
