# 07 — Google Sheets como fonte de preços

O Google Sheets é a **origem da tabela de preços e saldos**. Ele não é lido pelo
portal: uma rotina diária no GitHub Actions transforma o CSV e grava no Supabase, que
é de onde o portal lê.

```
Google Sheets  ──CSV──>  GitHub Actions  ──service_role──>  Supabase  ──>  Portal
  (você edita)            (valida e trava)                    (RLS)      (lê autenticado)
```

**Por que não ler o CSV direto no navegador:** publicar a aba na web a torna legível
por qualquer pessoa com o link — e a tabela traz **preço e saldo de estoque**, que são
informação comercial sensível. Passando pelo Supabase, o dado só é servido a
representante autenticado.

> Detalhes da sincronização, das travas de sanidade e dos segredos:
> `10-supabase-auth-e-dados.md` e `modelos/github-actions/sync-precos.yml`.

## Preparar a aba

**Não aponte a sincronização para a planilha de pedido.** Ela tem cabeçalho na linha
19, rodapé misturado e catálogo lateral nas colunas L–O — qualquer edição quebra tudo.

Crie uma aba `Precos` só com a tabela, cabeçalho na linha 1:

| `codigo_sigma` | `codigo_fabricante` | `descricao` | `valor_unitario` | `ipi` | `st` | `categoria` | `grupo` | `saldo` |
|---|---|---|---|---|---|---|---|---|

Ela pode ser alimentada por fórmula dentro do próprio Sheets, então você continua
editando a planilha do jeito de sempre. Para trazer `grupo` e `saldo`, cruze com o
catálogo lateral usando a **coluna L** (código limpo) como chave e a **coluna O** como
saldo:

```
=IFERROR(INDEX('PREÇOS...'!$O$20:$O$598; MATCH(A2; 'PREÇOS...'!$L$20:$L$598; 0)); "")
```

⚠️ O `status_estoque` **não** vai na planilha. Ele é calculado pelo banco a partir do
saldo (coluna gerada em `modelos/supabase/01-schema.sql`) — fonte única da verdade.

## Publicar como CSV

**Arquivo → Compartilhar → Publicar na web** → aba `Precos` → **CSV** → Publicar.

A URL sai assim:
```
https://docs.google.com/spreadsheets/d/e/2PACX-<id>/pub?gid=<ID_DA_ABA>&single=true&output=csv
```

Guarde-a no segredo `SHEETS_CSV_URL` do GitHub Actions.

⚠️ Publicar torna **aquela aba** legível por quem tiver o link. É aceitável para a aba
`Precos` (o link não é divulgado, e o risco é comercial, não pessoal). **Nunca publique
aba com dado de cliente** — esses vivem só no Supabase.

> O Google cacheia o CSV publicado por cerca de **5 minutos**. Editou a planilha e
> rodou a sincronização na mão? Espere 5 minutos, ou verá o conteúdo anterior.

## Formatos que o CSV traz (e que o script trata)

O Sheets exporta conforme a localidade da planilha. Em pt-BR, dinheiro sai como
`1.234,56`. O `sincronizar_supabase.py` já normaliza:

| Entrada | Vira |
|---|---|
| `1.234,56` | `123456` centavos |
| `81,40` | `8140` |
| `R$ 8,50` | `850` |
| `85.5` | `8550` |
| `` (vazio) | `None` |
| `#N/A`, `#REF!` | `None` |

**`None`, nunca `0`.** Zero é um preço válido que soma e some no total; `None` obriga a
interface a mostrar "—" e o usuário a perceber que falta dado.

O script também aceita **variações no nome das colunas** (`descricao` / `descrição` /
`Compatibilidade / Descrição`), porque a planilha é editada à mão. Mas se
`codigo_sigma` ou `valor_unitario` sumirem, ele para com erro claro em vez de gravar lixo.

## Quando a planilha muda de formato

A tabela é atualizada toda semana. Se a Sigma mexer no layout:

1. A Action falha com "Colunas obrigatórias ausentes no CSV" e mostra o cabeçalho recebido.
2. **O catálogo anterior continua no ar.** O portal segue funcionando com o preço da
   semana passada, avisando a data — melhor que preço errado ou catálogo vazio.
3. Ajuste a aba `Precos` (ou o mapa `COLUNAS` do script) e rode o workflow na mão.

## O caminho manual continua existindo

`ferramentas/importar_precos.py` lê o `.xlsx` direto, sem depender do Sheets. Serve
para conferir uma planilha nova antes de publicá-la e para a carga inicial. A diferença
é só a origem — as regras de negócio (centavos, IPI de 4 casas, semáforo de estoque)
são as mesmas nos dois caminhos.
