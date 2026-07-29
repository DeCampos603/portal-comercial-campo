# 01 — Negócio e domínio

## Quem é o usuário

**Representante comercial** de peças de reposição para eletrodomésticos, atuando pela
**M A JOAQUIM REPRESENTACAO [25]** e vendendo produtos da **Sigma**. Identificado como
**"Marcelo"** no campo `Vendedor` do pedido.

Território principal: **Rio de Janeiro**. A rotina é de rua — ele visita lojas de peças,
assistências técnicas e distribuidores, monta o pedido no local e envia para a Sigma.

## O que ele vende

Peças de reposição, agrupadas em **24 grupos** de catálogo:

| Grupo | Itens | Grupo | Itens |
|---|---:|---|---:|
| 015-PEÇAS DIVERSAS | 142 | 013-FILTROS | 16 |
| 023-CAPACITOR | 67 | 022-MOTOR CONDENSADORA | 13 |
| 006-SENSOR | 37 | 021-RELÉ | 13 |
| 011-MOTO VENTILADOR | 35 | 016-PLACA | 13 |
| 018-CORREIA | 35 | 005-RETENTOR | 13 |
| 014-AR CONDICIONADO | 30 | 004-ELETROBOMBA | 13 |
| 002-TRAVA DE PORTA | 28 | 028-MOTOR EVAPORADORA | 12 |
| 009-VALVULA | 23 | 003-TERMOSTATO | 8 |
| 001-GUARNICOES | 21 | 007-TERMISTOR | 8 |
| 008-EIXO TRIPE | 20 | 020-AMORTECEDOR | 8 |
| 010-PUXADOR | 6 | 024-OUTROS | 8 |
| 025-MICROONDAS | 6 | 012-RESISTENCIA | 4 |

Marcas de origem visíveis nos códigos OEM: Samsung (`DC…`), LG (`EB…`, `MDS…`, `4…`),
GE/Mabe (`WR…`, `WI…`).

## Categorias comerciais (definem a comissão)

Diferente dos *grupos* de catálogo, as **categorias** existem só para calcular comissão:

| Categoria | Itens | Comissão |
|---|---:|---:|
| Lava e seca | 207 | 5,0% |
| Refrigerador | 112 | 4,0% |
| AC | 87 | 3,0% |
| Lavadora | 53 | 3,0% |
| Tanquinho | 18 | 3,0% |
| Micro-ondas | 14 | 4,0% |
| Ventilador | 12 | 3,0% ⚠️ |
| AC - SICCOM | 8 | 5,0% |
| AC - COBRE | 5 | 0,8% |
| Rolamento NSK | 3 | 1,2% |
| Universal | 1 | 3,0% |
| TERMOMETRO / HIGROMETRO LCD | 1 | 3,0% |

⚠️ **Ventilador** retorna `#N/A` na planilha original por erro de intervalo no
`VLOOKUP`. O valor correto da tabela é 3% — confirmar (ver `PENDENCIAS.md`).

> A base de cálculo da comissão (com ou sem IPI) **ainda não está definida**.
> É a pendência 🔴 nº 1.

## A carteira de clientes

**328 clientes**, em dois arquivos **sem sobreposição** (verificado: interseção = 0):

| Arquivo | Clientes | O que significa |
|---|---:|---|
| `Clientes inativos.xlsx` | 300 | Pararam de comprar — alvo de reativação |
| `Clientes em recuperação.xlsx` | 28 | Já em processo ativo de retomada |

### Status comercial

| Status | Inativos | Recuperação | Total |
|---|---:|---:|---:|
| `Sem Título` | 229 | 3 | 232 |
| `Com Título` | 65 | 23 | 88 |
| `Atrasado` | 6 | 2 | 8 |

"Título" é duplicata/boleto. A interpretação exata é pendência 🟢 — mas a leitura
provável é: `Com Título` tem faturamento em aberto, `Atrasado` está inadimplente,
`Sem Título` não tem pendência financeira. **Isto define a cor no mapa**, então
confirme antes de codificar semântica de risco.

### Distribuição geográfica

**UF:** RJ 317 · ES 9 · RS 1 · MG 1

**Top cidades (inativos):** Rio de Janeiro 137 · Nova Iguaçu 15 · Duque de Caxias 12 ·
São Gonçalo 11 · Macaé 11 · Volta Redonda 10 · Niterói 8 · São João de Meriti 8 ·
Rio das Ostras 8 · Serra (ES) 6 · Itaboraí 6

**Bairros:** 170 distintos. Concentração em Centro (43), Bonsucesso (12), Taquara (7),
Cascadura (7), Penha Circular (7).

**Leitura estratégica:** quase metade da carteira está na capital, e há
**clusters densos** — Bonsucesso/Ramos/Olaria/Penha formam um corredor da Leopoldina
com ~30 clientes. Isso é a base do roteirizador: um dia de visitas bem montado cobre
6–8 clientes de um corredor, não 6 clientes espalhados pelo estado.

### Qualidade dos dados da carteira

| Aspecto | Situação | Impacto |
|---|---|---|
| CEP | 100% preenchido | ✅ Base da geocodificação |
| Logradouro | **Sem número** | ⚠️ Precisão de rua, não de porta |
| Telefone | 2 vazios | ✅ |
| E-mail | 10 vazios | ✅ |
| `Contato` (nome da pessoa) | **100% vazio** | 🔴 Campo inútil hoje — oportunidade |
| `Representante` | 100% igual | ⚠️ Coluna sem informação — descartar na UI |
| Nome do cliente | Sufixo `[código]` duplicado | Limpar na importação |
| Cidade | Grafia inconsistente | `SÃO GONÇALO` vs `SAO GONCALO`, `NITERÓI` vs `NITEROI` — normalizar |
| Matriz/filial | Mesma razão social, códigos diferentes | FRIOTEC ×3, SUL FLUMINENSE ×4 |

## O fluxo de trabalho atual (o que o portal substitui)

1. Recebe a tabela de preços atualizada **toda semana** (itens e valores mudam).
2. Abre o Excel, procura a peça na lista de 521 itens rolando a tela.
3. Digita a quantidade; o Excel calcula produto e IPI.
4. Confere a comissão em **outra aba**.
5. Preenche cabeçalho (cliente, CNPJ, endereço) **na mão**, toda vez.
6. Envia o pedido para a Sigma.
7. Controla visitas e clientes em planilhas separadas, sem mapa e sem agenda.

**As dores, na ordem:** buscar item numa lista de 521 linhas; redigitar o cadastro do
cliente a cada pedido; não enxergar quem está perto de quem; não ter agenda de visitas;
tabela desatualizada sem aviso; e dois bugs de fórmula que fazem a planilha **calcular
errado em silêncio** (ver `03-motor-de-cotacoes.md`).

## Oportunidades que o portal abre

Coisas que a planilha não permite e que valem mais que a digitalização em si:

- **Roteiro por proximidade.** "Estou em Bonsucesso, quem mais visito hoje?"
- **Fila de reativação priorizada.** 300 inativos é uma lista inutilizável. Ordenada por
  proximidade + status + tempo sem compra, vira um plano de trabalho.
- **Comissão projetada em tempo real.** Ver quanto uma cotação rende **enquanto** monta.
- **Cadastro do cliente que se preenche sozinho.** Escolheu o cliente → cabeçalho pronto.
- **Semáforo de estoque à vista.** Hoje a cor só existe se ele abrir a planilha e rolar
  até a linha. No portal, o status aparece **na busca**, antes de escolher a peça:
  **69 itens sem estoque** e **111 com estoque baixo** entre os 521. Cotar peça que não
  existe queima confiança com o cliente.
- **Histórico de visita e contato** — hoje simplesmente não existe.
