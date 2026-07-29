# 03 — Motor de cotações (regras de negócio)

Este é o arquivo mais crítico do projeto. Um erro aqui vira um pedido errado, dinheiro
perdido e credibilidade queimada com o cliente. **Nada aqui pode ser suposto.**

## Estrutura do pedido original (Excel da Sigma)

Aba `PREÇOS OUTROS ESTADOS - CLIENTE` — é este formato que o cliente recebe.

### Cabeçalho (linhas 1–18)

| Campo | Observação |
|---|---|
| `Pedido Nº` | Vazio — geração é pendência |
| `Vendedor` | "Marcelo" (fixo) |
| `Data` | Data da emissão |
| `Cliente/Fornecedor` | Preenchido à mão hoje → **autopreencher pela carteira** |
| `CNPJ` / `I.E` | idem |
| `Endereço` | idem |
| `Contato` / `Depto.` | idem |
| `Fone / Fax` | idem |
| `CONFORME ORÇAMENTO Nº` | Referência a orçamento anterior |

### Tabela de itens (a partir da linha 19)

| Col | Cabeçalho | Tipo | Origem |
|---|---|---|---|
| A | `Item` | int | Sequencial |
| B | `code` | texto | Código OEM do fabricante — **2 duplicatas, não usar como chave** |
| C | `Código Sigma` | texto | **CHAVE PRIMÁRIA** — 521 valores, 100% únicos |
| D | `Compatibilidade / Descrição` | texto | Descrição comercial |
| E | `Qtd.` | número | **Entrada do usuário** |
| F | `IPI` | decimal | Alíquota (0 a 0,20) |
| G | `ST` | `Sim`/`Não` | Sinalizador — **sem cálculo associado** |
| H | `Valor Unitario` | R$ | Preço de tabela |
| I | `Valor dos Produtos` | R$ | **Calculado** |
| J | `Valor Total com IPI` | R$ | **Calculado** |

### Catálogo lateral (colunas L–O)

Lista de referência com **579 itens**, em quatro colunas:

| Col | Conteúdo |
|---|---|
| **L** | **Código Sigma limpo** — é a chave usada no `MATCH`. Prefira esta |
| M | `"CÓDIGO - DESCRIÇÃO"` concatenados |
| N | Grupo |
| **O** | **Saldo** (estoque) |

- **10 itens da tabela de preços não existem aqui** → ficam sem grupo e sem saldo.
  Trate como `grupo: null`, `saldo: null`, `statusEstoque: null`. Não invente.

## 🚦 Semáforo de estoque (as linhas coloridas)

**As cores da planilha são o dado mais importante que o `Saldo` sozinho não conta.**
Elas não são preenchimento fixo — vêm de **formatação condicional**, que consulta o
código na coluna `L` e devolve o saldo da coluna `O`:

```excel
Vermelho: INDEX($O$20:$O$720; MATCH($C20; $L$20:$L$720; 0)) < 6
Amarelo:  INDEX(...) > 6  E  INDEX(...) < 200
```

| Status | Regra | Itens | Significado |
|---|---|---:|---|
| 🔴 `sem_estoque` | saldo **< 6** | **69** | Não vender. 52 estão zerados, 17 têm de 1 a 5 unidades |
| 🟡 `baixo` | saldo **< 200** | **111** | Estoque acabando — avisar o cliente do prazo |
| 🟢 `ok` | saldo **≥ 200** | **331** | Pode vender à vontade |
| ⬜ `null` | fora do catálogo | **10** | Saldo desconhecido — não afirme que tem |

⚠️ **Vermelho não é "saldo zero".** É "menos de 6 unidades" — na prática, quantidade
que não sustenta um pedido. Quem lê a planilha entende "não tem"; o portal deve mostrar
o número real (`Saldo: 3`) junto do selo, para o usuário decidir.

Contexto: o saldo máximo da base é **64.501** unidades. Por isso 200 é "baixo" — a
escala destes itens é de milhares, não de dezenas.

> **Estes limiares vêm da planilha atual e podem mudar.** Mantenha-os como constantes
> nomeadas (`SALDO_SEM_ESTOQUE = 6`, `SALDO_BAIXO = 200`), nunca espalhados pelo código.

### Aba COMISSÃO

Mesmo formato, mais duas colunas: `Categoria` (K) e `Comissão` (L, alíquota via
`VLOOKUP` na aba `Planilha1`). É a **visão interna** do representante.

## Fórmulas — as que existem

```
I (Valor dos Produtos)   = H × E                    // unitário × quantidade
J (Valor Total com IPI)  = I × (1 + F)              // produtos + IPI
Valor Total dos Produtos = SOMA(I)                  // todos os itens
Valor Total com IPI      = SOMA(J)                  // todos os itens
Comissão (alíquota)      = PROCV(Categoria; tabela) // por categoria
```

**Não existe fórmula de ST nem de valor de comissão.** Ver `PENDENCIAS.md`.

## 🐞 Bugs confirmados na planilha original

Verificados diretamente no arquivo. **O portal corrige os dois.**

### Bug 1 — Dois itens fora do total

```
Fórmula:  =SUM(I20:I538)   e   =SUM(J20:J538)
Realidade: os itens vão até a linha 540 (item 521)
```

Ficam **fora da soma**:

| Linha | Item | Código Sigma | Descrição | Valor |
|---|---:|---|---|---:|
| 539 | 520 | `SDE-1402M-U` | DUTO EXAUSTAO PARA AC - ANTIHORARIO | R$ 85,50 |
| 540 | 521 | `SVA-92103-X` | VÁLVULA 127V - 2 VIAS | R$ 64,50 |

**Consequência real:** um pedido que inclua essas peças fecha com valor **menor** que o
correto — e ninguém percebe, porque a planilha não acusa erro. Se já foram vendidas
assim, houve prejuízo silencioso.

### Bug 2 — Categoria "Ventilador" retorna `#N/A`

```
Fórmula:  =VLOOKUP(K20; Planilha1!$A$1:$B$12; 2; 0)
Realidade: "Ventilador" está na LINHA 13 da Planilha1 — fora do intervalo
```

**Consequência:** 12 capacitores de ventilador ficam **sem comissão calculada**
(`SCA-1,5UF450V(S)-T`, `SCA-2UF450V(S)-T`, … `SCA-10UF250V-F`).

O portal usa a tabela completa das 12 categorias e aplica **3%**.

### Bug 3 — Saldo exatamente 6 não pega cor nenhuma

```
Vermelho: saldo < 6
Amarelo:  saldo > 6  E  saldo < 200
                ↑
        o valor 6 não satisfaz nenhuma das duas
```

O item **`SCT-00952-W` (saldo 6)** aparece **sem cor** na planilha — passa como se
tivesse estoque normal, quando na verdade tem 6 unidades.

**No portal, o 6 entra em `baixo` (🟡).** A lacuna é descuido de fórmula, não regra.

### Outras fragilidades (menores)

- Intervalos de `VLOOKUP` inconsistentes (`$C$20:$F$985` vs `$C$20:$H$636`) — ambos
  passam muito do fim real dos dados. Inofensivo hoje, quebra se a planilha crescer.
- IPI gravado como `0.052000000000000005` — ruído de ponto flutuante.
  **Arredonde para 4 casas na importação.**
- As linhas de rodapé (`OBSERVAÇÕES`, `Dados para Faturamento / Entrega`,
  `Responsável pela Aprovação`) têm texto na coluna A e são lidas como se fossem itens.
  **Corte a leitura no item 521 / linha 540.**

## Como o portal calcula (implementação canônica)

### Regra de ouro: centavos inteiros

```js
// Toda a aritmética em inteiros. Converte na entrada, formata na saída.
const paraCentavos = (reais) => Math.round(Number(reais) * 100);
const paraReais    = (centavos) => centavos / 100;
const formatarBRL  = (centavos) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(centavos / 100);
```

### Cálculo de uma linha

> **Escopo definido pelo usuário:** o portal **não calcula comissão nem ST**. A alíquota
> de comissão e o sinalizador de ST continuam nos dados (podem virar selo informativo),
> mas nenhum valor é apurado a partir deles. Só IPI entra na conta.

```js
/**
 * Calcula uma linha da cotação.
 * @param {{valorUnitarioCentavos:number, ipi:number}} item
 * @param {number} quantidade
 */
function calcularLinha(item, quantidade) {
  const qtd = Math.max(0, Math.trunc(Number(quantidade) || 0));

  // Valor dos Produtos = unitário × qtd
  const valorProdutos = item.valorUnitarioCentavos * qtd;

  // Valor com IPI = produtos × (1 + IPI). Arredonda AQUI, uma vez.
  const valorIpi = Math.round(valorProdutos * item.ipi);
  const valorComIpi = valorProdutos + valorIpi;

  return { qtd, valorProdutos, valorIpi, valorComIpi };
}
```

**Item sem preço → `null`, nunca `0`.** `0` é um valor válido que soma e desaparece no
total; `null` obriga a interface a mostrar "—" e o usuário a perceber que falta dado.
É exatamente o erro que a planilha comete ao deixar o `#N/A` passar em silêncio.

### Totais

```js
function calcularTotais(linhas) {
  const somar = (campo) => linhas.reduce((acc, l) => acc + (l[campo] ?? 0), 0);
  return {
    totalProdutos: somar('valorProdutos'),
    totalIpi:      somar('valorIpi'),
    totalComIpi:   somar('valorComIpi'),
    // Alertas de estoque — o que o usuário precisa ver ANTES de fechar
    itensSemEstoque: linhas.filter(l => l.item.statusEstoque === 'sem_estoque').length,
    itensEstoqueBaixo: linhas.filter(l => l.item.statusEstoque === 'baixo').length,
  };
}
```

Some **todas** as linhas. Sem intervalo fixo, sem `SUM(I20:I538)`. O bug 1 não se repete.

## Alíquotas de IPI encontradas

`0` · `1,3%` · `3,25%` · `5%` · `5,2%` · `6,5%` · `7,8%` · `9,75%` · `10%` · `11,7%` ·
`13%` · `20%`

O IPI vem **por item** na planilha — nunca hardcode, sempre leia do dado.

## Substituição Tributária (ST)

11 itens têm `ST = Sim`. **Não há cálculo, e o usuário definiu que não haverá.**
- Exiba um selo visível "ST" na linha do item.
- **Não some nada** a título de ST.
- Inclua no PDF a observação: `Itens com ST sujeitos a apuração — consultar Sigma.`

Inventar um MVA seria o pior erro possível deste projeto.

## Requisitos da interface de cotação

O que transforma isto de "planilha na web" em ferramenta melhor:

1. **Busca instantânea** sobre 521 itens, casando **código Sigma, código OEM e
   descrição** ao mesmo tempo, tolerante a acento e caixa. Resposta a cada tecla.
2. **Teclado primeiro no desktop:** busca → `Enter` adiciona → foco pula para a
   quantidade → `Enter` volta para a busca. Um pedido de 20 itens sem tocar no mouse.
3. **🚦 Semáforo de estoque em todo lugar** — este é o requisito nº 1 de negócio:
   - **Na busca**, antes de escolher: item 🔴 aparece com o selo e o saldo real
     (`Saldo: 3`), para nem entrar na cotação por engano.
   - **Na linha da cotação**, se já estiver lá.
   - **No rodapé**, consolidado: *"⚠️ 2 itens sem estoque nesta cotação"*.
   - **Ao exportar**, bloqueio suave: *"Esta cotação tem 2 itens sem estoque. Enviar
     assim mesmo?"* — cotar peça que não existe queima confiança com o cliente.
   - Quantidade acima do saldo disponível também alerta (`pediu 50, há 12`).
4. **Filtro "só com estoque"** na busca — em muitos casos é o modo padrão desejado.
5. **Cliente da carteira:** escolher o cliente preenche todo o cabeçalho.
6. **Dois modos de saída:**
   - *Interno* — tudo, inclusive comissão e saldo.
   - *Cliente* — PDF/link no formato do pedido Sigma, **sem** comissão, **sem** saldo,
     **sem** categoria.
7. **Rascunho automático.** Salve a cotação em andamento no `localStorage` a cada
   mudança. Fechar a aba sem querer não pode custar 20 minutos de trabalho.
8. **Aviso de tabela velha.** Se o CSV de preços tem mais de 7 dias, faixa no topo:
   "Tabela de preços de DD/MM — pode estar desatualizada."

## Filtro de sanitização (requisito de segurança)

Toda saída para o cliente passa por aqui. Testar como se fosse código de segurança.

```js
const CAMPOS_PROIBIDOS_NO_CLIENTE = [
  'comissao', 'aliquotaComissao', 'totalComissao',
  'categoria', 'custo', 'margem',
  // 🔴 Saldo é informação interna: o cliente não pode saber quanto há em estoque.
  'saldo', 'statusEstoque', 'itensSemEstoque', 'itensEstoqueBaixo',
];

function sanitizarParaCliente(cotacao) {
  const limpar = (obj) => Object.fromEntries(
    Object.entries(obj).filter(([k]) => !CAMPOS_PROIBIDOS_NO_CLIENTE.includes(k))
  );
  return {
    ...limpar(cotacao),
    linhas: cotacao.linhas.map(limpar),
    totais: limpar(cotacao.totais),
  };
}
```

Rode o filtro na **geração do artefato**, não na renderização. Se o dado nunca entra no
HTML do PDF, não há CSS, "inspecionar elemento" ou print que o revele.
