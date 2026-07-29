---
name: importar-dados
description: Converte as planilhas Excel (tabela de preços e listas de clientes) em JSON normalizado e validado, e geocodifica os clientes por CEP. Use quando o usuário mandar planilhas novas, pedir para atualizar os dados, importar o catálogo, importar a carteira, ou quando o portal estiver com dados desatualizados.
---

# Importar dados das planilhas

Transforma os `.xlsx` de origem em JSON limpo, validado e pronto para o portal.
**Toda importação emite um relatório** — sem ele você não sabe o que se perdeu no caminho.

## Antes de começar

1. Leia `conhecimento/03-motor-de-cotacoes.md` (layout da tabela de preços) e
   `conhecimento/04-dados-de-clientes.md` (limpeza da carteira).
2. Confirme os caminhos dos arquivos com o usuário. Não presuma a Área de Trabalho.
3. ⚠️ **Nunca copie o `.xlsx` para dentro do repositório.** Leia de onde ele está.
   O `.gitignore` bloqueia, mas não conte com isso.

## Passo 1 — Inspecionar antes de converter

A planilha muda toda semana. **Nunca presuma que o layout continua o mesmo.**

```bash
python ferramentas/inspecionar_planilha.py "<caminho do xlsx>"
```

Confirme, comparando com o conhecimento registrado:
- Nomes das abas (`PREÇOS OUTROS ESTADOS - CLIENTE`, `-COMISSÃO`, `Planilha1`)
- Cabeçalho dos itens ainda na **linha 19**; dados a partir da **20**
- Ordem das colunas (`Item`, `code`, `Código Sigma`, …)
- Onde os itens terminam (era o item 521, linha 540)

**Mudou algo? Pare e avise o usuário** antes de importar. Importar com layout diferente
gera dado errado silenciosamente — exatamente o que este projeto existe para eliminar.

## Passo 2 — Importar o catálogo

```bash
python ferramentas/importar_precos.py "<xlsx>" --saida dados/privado/catalogo.json
```

O script precisa:
- Ler `Código Sigma` como **chave primária** (única). `code` (OEM) tem duplicata — nunca é chave.
- Converter preço para **centavos inteiros**.
- Arredondar o IPI para **4 casas** (mata o `0.052000000000000005`).
- Cruzar com o catálogo lateral (**L**=código, M=descrição, N=grupo, **O**=saldo) para
  trazer `grupo`, `saldo` e `statusEstoque`.
  Não achou → tudo `null`. **Nunca invente.**
- Classificar o **semáforo de estoque** com os limiares da formatação condicional:
  `< 6` → 🔴 `sem_estoque` · `< 200` → 🟡 `baixo` · resto → 🟢 `ok`.
  Confira no relatório: devem sair **69 / 111 / 331 / 10 sem dado**. Número muito
  diferente disso significa que a Sigma mexeu no estoque ou nos limiares — investigue.
- Ler a categoria na aba COMISSÃO e a tabela de comissões da `Planilha1` **completa**
  (12 linhas — o `VLOOKUP` original para na 12 e quebra "Ventilador").
- **Parar no último item real**, ignorando o rodapé (`OBSERVAÇÕES`,
  `Dados para Faturamento / Entrega`, `Responsável pela Aprovação`).

## Passo 3 — Importar a carteira

```bash
python ferramentas/importar_clientes.py \
    --inativos "<xlsx inativos>" \
    --recuperacao "<xlsx recuperação>" \
    --saida dados/privado/clientes.json
```

Aplique as regras de `conhecimento/04`: remover sufixo `[código]`, normalizar telefone
e CEP, unificar grafia de cidade, descartar a coluna `Representante`, derivar
`grupoEconomico` e `whatsapp`.

## Passo 4 — Geocodificar

```bash
python ferramentas/geocodificar.py dados/privado/clientes.json --cache cache/geocode.json
```

Regras inegociáveis (`conhecimento/05`):
- **1 requisição por segundo** ao Nominatim. Sem paralelismo.
- `User-Agent` identificável com contato real.
- **Grave o cache a cada resultado**, não no fim.
- Registre `precisao` (`rua` | `bairro` | `cidade`) em cada coordenada.
- 🔴 **CEP primeiro, e `bounded=1` na caixa do MUNICÍPIO.** Este projeto já errou aqui
  três vezes: texto livre mandou 20% da carteira para outros estados; depois a caixa da
  UF ainda deixou endereços do Centro caírem em Campos; e nome de rua se repete entre
  bairros do próprio Rio. O CEP resolve — é único no Brasil e a carteira tem 100% dele.
  Detalhes e números medidos em `conhecimento/05`.

**Leia o fim do relatório:** ele confere pino a pino se a coordenada caiu dentro do
município do cliente. Qualquer linha em `🔴 clientes com coordenada FORA do próprio
município` é bloqueante — não carregue.

Leva ~10 minutos para 328 clientes (inclui delimitar cada município uma vez).
Rodando de novo, só processa os CEPs novos.

## Passo 5 — Validar

Os três scripts já validam e imprimem os problemas no próprio relatório. **Leia o
relatório, não pule.** Trate como bloqueante:

- Código Sigma duplicado ou ausente
- Preço nulo, negativo ou zero
- Categoria sem comissão correspondente
- Cliente sem código ou com CEP inválido
- Queda brusca na taxa de geocodificação em relação à importação anterior

## Passo 6 — Relatório e revisão

Apresente ao usuário, **sem maquiar**:

```
CATÁLOGO      521 itens · 24 grupos · 12 categorias
              🚦 69 sem estoque · 111 baixo · 331 ok · 10 sem dado
CARTEIRA      328 clientes (300 inativos + 28 recuperação)
              ⚠️  10 sem e-mail · 2 sem telefone · 328 sem contato
GEO           293 rua (89%) · 34 bairro (10%) · 1 cidade · 0 falhou
              ✅ todo pino dentro do município do cliente
```

Compare com a importação anterior e **destaque as diferenças**: itens novos, itens que
sumiram, preços que mudaram muito. Uma variação de 40% num preço costuma ser erro de
digitação na planilha — vale perguntar antes de publicar.

## Passo 7 — Enviar para o Supabase

```bash
python ferramentas/carga_inicial.py --simular
python ferramentas/carga_inicial.py
```

Só depois da validação limpa. É **upsert** — pode repetir sem duplicar, então dá para
geocodificar depois e recarregar.

⚠️ Os JSON ficam em `dados/privado/` como *staging* e **nunca** são versionados.
Não existe mais `portal/dados/` — dado de cliente não entra no repositório.

## Erros comuns

| Sintoma | Causa |
|---|---|
| Preços zerados | Leu a coluna I/J (fórmula sem qtd.) em vez da H (`Valor Unitario`) |
| Itens a mais | Não parou no rodapé — está lendo `OBSERVAÇÕES` como item |
| Itens a menos | Copiou o `SUM(I20:I538)` da planilha. **Leia até o último item real** |
| Categoria sem comissão | Leu só 12 linhas da `Planilha1`. São **12 categorias**, confira o intervalo |
| Acento quebrado | Faltou `encoding='utf-8'` ao gravar o JSON |
| Nominatim recusando | Sem `User-Agent` ou passando de 1 req/s |
| Pino em outro estado | Busca em texto livre sem `bounded=1` — ver `conhecimento/05` |
