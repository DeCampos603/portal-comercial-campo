# Pendências — o que NÃO pode ser inventado

Regras de negócio, fiscais e comerciais que **não estão** nas planilhas e precisam ser
confirmadas com o usuário ou com a Sigma. Enquanto estiverem abertas, o portal deve
mostrar `[[CONFIRMAR: ...]]` no lugar do valor — **nunca** um número plausível.

> Ao resolver uma pendência: marque `[x]`, registre a resposta aqui **e** atualize o
> arquivo de `conhecimento/` correspondente na mesma tarefa.

---

## ✅ Descartado pelo usuário (não implementar)

- [x] **Comissão — não é calculada.** O usuário definiu que o portal ignora o cálculo
  de comissão. A alíquota por categoria continua nos dados e pode virar selo
  informativo, mas nenhum valor é apurado nem exibido como total.
- [x] **Substituição Tributária (ST) — não é calculada.** Os 11 itens marcados
  `ST = Sim` ganham apenas um **selo visual** e a observação no PDF
  (`Itens com ST sujeitos a apuração — consultar Sigma`). Nenhum MVA é aplicado.

Consequência: `SMV-42655-W` (sem categoria) e os 12 capacitores "Ventilador"
(`#N/A` na planilha) deixam de ser problema — nada depende mais de categoria.

## 🔴 Bloqueiam cálculo

- [ ] **Limiares de estoque podem mudar.** Os valores atuais (`< 6` = sem estoque,
  `< 200` = baixo) foram extraídos da formatação condicional da planilha desta semana.
  Confirmar que são regra estável, e não um ajuste pontual.
  → Referência: `conhecimento/03-motor-de-cotacoes.md`, seção "Semáforo de estoque".

- [x] **Atualização do saldo — RESPONDIDO.** O saldo vem junto na planilha semanal.
  Consequência: o semáforo tem a idade da última sincronização. O portal exibe a data
  do catálogo (`atualizado_em`) e avisa quando passa de 7 dias.

## ✅ Resolvido — agora o representante preenche no portal

- [x] **Dados do cabeçalho, numeração e condições.** Deixaram de ser pendência: o
  portal tem campos editáveis para razão social, CNPJ, I.E., telefone, e-mail,
  número do pedido, condições de pagamento, prazo, validade e frete.
  - Dados da representação: digitados **uma vez** (⚙️ Dados da representação).
  - Dados do pedido: guardados e reaparecem na cotação seguinte.
  - Numeração avança sozinha, preservando prefixo e zeros ("MJ-0042" → "MJ-0043").
  - Campo em branco vira **linha para preencher à caneta** no PDF — nunca um
    valor inventado.

- [x] **Logomarcas — RECEBIDAS (03/08/2026).** SIBB e M A Joaquim estão embutidas
  em base64 no cabeçalho do pedido. Ver `ferramentas/preparar_logos.py`.
  Nunca baixar logo da internet: o arquivo vem do usuário.

- [x] **Carteira de ATIVOS — RECEBIDA (03/08/2026).** 51 clientes, 50 deles
  inéditos. Ver `conhecimento/04-dados-de-clientes.md`.

## 🟡 Ainda em aberto (não bloqueiam)

- [ ] **SIBB ou Sigma?** A logo recebida é da **SIBB**, mas o rodapé do pedido diz
  "consultar a Sigma" e "Autorização Sigma", e a coluna do catálogo é "Código Sigma".
  São a mesma empresa, duas empresas, ou marca e distribuidor? Enquanto não se sabe,
  o texto do rodapé fica como está — mudar por conta própria seria inventar.

- [ ] **Pedido mínimo** (valor ou quantidade), se existir — hoje o portal não valida.
- [ ] **Fluxo de aprovação.** O rodapé tem "Responsável pela Aprovação - Representante"
  e "Autorização Sigma" — o PDF reproduz os dois campos para assinatura. Falta saber
  como o pedido chega à Sigma hoje (e-mail, portal, WhatsApp), para automatizar o envio.

## 🟢 Melhoram o portal, não bloqueiam

- [ ] **Link do Google Sheets** da aba `Precos` publicada como CSV → vira o segredo
  `SHEETS_CSV_URL` do GitHub Actions.
- [ ] **Dia da semana** da atualização de preços — para avisar "tabela desatualizada".
- [ ] **Significado exato dos status:** `Com Título` = tem duplicata em aberto?
  `Atrasado` = inadimplente? `Sem Título` = sem pendência financeira?
  Isso define a **cor e a prioridade** de cada cliente no mapa.
- [ ] **Critério de "inativo"** — quantos meses sem comprar? Existe data da última compra?
  (Seria o campo mais valioso a acrescentar na carteira.)
- [x] **Campo `Contato` — RESOLVIDO.** Está 100% vazio na origem. O portal permite
  preencher, e grava na coluna `contato` da tabela `clientes` no Supabase.
- [ ] **Metas** de visitas/mês e de faturamento, para o painel inicial.
- [ ] **Filiais.** Clientes como FRIOTEC e SUL FLUMINENSE aparecem em várias linhas com
  códigos diferentes. Tratar como matriz/filial agrupada ou como clientes independentes?
