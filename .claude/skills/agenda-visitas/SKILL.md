---
name: agenda-visitas
description: Constrói a agenda de visitas — agendamento, visões de hoje/semana/planejamento, fila priorizada de clientes a visitar, registro de resultado, sincronização offline e exportação para calendário. Use quando o usuário pedir a agenda, agendamento, roteiro de visitas, planejamento da semana ou controle de visitas.
---

# Agenda de visitas

A agenda não é um calendário. É a resposta para **"quem eu deveria estar visitando?"** —
com 328 clientes e ~8 visitas por dia, decidir é mais difícil que anotar.

## Antes de começar

Leia `conhecimento/06-agenda-de-visitas.md` (modelo de dados e telas) e
`conhecimento/10-supabase-auth-e-dados.md` (sincronização). A escrita depende do
Supabase configurado — se ainda não estiver, rode antes a skill `integrar-supabase`.

## Ordem de construção

### 1. Camada local primeiro (funciona sem nuvem)

Construa a agenda gravando em **IndexedDB**, com interface completa, antes de ligar no
Supabase. Assim o módulo é testável e útil desde o primeiro dia, e a sincronização vira
um detalhe de infraestrutura em vez de um pré-requisito.

```js
await filaLocal.gravar(visita);   // 1. local, instantâneo
atualizarInterface(visita);       // 2. tela responde já
sincronizar();                    // 3. nuvem, em segundo plano — SEM await
```

**A interface nunca espera a rede.** Essa é a regra que faz o módulo funcionar em campo.

### 2. As três telas

| Tela | Pergunta que responde | Prioridade |
|---|---|---|
| **Hoje** | "O que faço agora?" | 🔴 Primeira a construir |
| **Semana** | "Meu plano está equilibrado?" | 🟡 |
| **Planejar** | "Quem eu deveria visitar?" | 🔴 A mais valiosa |

**Hoje** é a tela de abertura no celular. Layout em `conhecimento/06`. O botão
`[Cheguei]` precisa registrar presença e abrir o formulário de resultado em **um toque**.

**Planejar** usa `pontuarPrioridade()` (código em `conhecimento/06`) e — isto é
essencial — **mostra o motivo** ao lado de cada cliente: *"187 dias sem visita · em
recuperação · no corredor de terça"*. Ordenação sem explicação é ignorada.

### 3. Registro de resultado

Sem resultado, a agenda é só um calendário bonito. Com resultado, ela alimenta a
priorização, o histórico do cliente e os relatórios.

Formulário mínimo (10 segundos para preencher, ou não será preenchido):
- Compareceu? sim/não
- Desfecho: pedido · orçamento · sem interesse · fechado · retornar
- Valor (se pedido)
- Próximo passo + data

### 4. Sincronização

Fila + reenvio + indicador visível (`✅ / 🔄 / ⏳ 3 / ⚠️`). Código em `conhecimento/06`.

**Idempotência é obrigatória:** o `id` é gerado no cliente (é `text`, chave primária) e
o Supabase faz *upsert*. Sem isso, cada reenvio da fila duplica a visita.

### 5. Exportar para o calendário

Não há servidor para notificar. A solução é gerar um `.ics` que o usuário importa no
Google Calendar/Outlook — aí o alerta chega no celular. Código em `conhecimento/06`.

⚠️ O padrão iCalendar exige quebra de linha `\r\n`. Com `\n`, o Outlook recusa o
arquivo em silêncio.

### 6. Integração com os outros módulos

| De → Para | O que acontece |
|---|---|
| Mapa → Agenda | Pino "Agendar" abre o formulário com o cliente preenchido |
| Agenda → Mapa | "Ver no mapa" plota as visitas do dia, na ordem |
| Agenda → Cotações | "Nova cotação" abre com o cabeçalho do cliente pronto |
| Cotações → Agenda | Cotação salva vincula à visita, desfecho "orçamento" |
| Agenda → Carteira | Visita realizada atualiza `ultimaVisita` |

Esse ciclo fechado é o que separa **um sistema** de quatro telas soltas. Não deixe para
depois — é onde está o valor.

## Testes obrigatórios

```
FUNCIONAL
[ ] Agendar pelo mapa preenche o cliente sozinho
[ ] Visita realizada atualiza ultimaVisita na carteira
[ ] Fila de priorização mostra o MOTIVO de cada cliente
[ ] Registro de resultado leva menos de 15 segundos

OFFLINE (testar em modo avião — não é opcional)
[ ] Agendar offline funciona e mostra "pendente"
[ ] Voltando a rede, sincroniza sozinho
[ ] Sincroniza UMA vez só (sem duplicar)
[ ] Reenviar a mesma visita 3× mantém 1 linha na tabela `visitas`
[ ] Perder a rede NÃO desloga o usuário (erro de auth = offline)
[ ] Fechar e reabrir o app não perde a fila

CONFLITO
[ ] Editar no painel do Supabase e no portal não apaga dado silenciosamente

CALENDÁRIO
[ ] .ics importa no Google Calendar sem erro
[ ] .ics importa no Outlook (é onde o \r\n quebra)
[ ] Alarme de 30 min antes funciona
```

## Armadilhas

| Sintoma | Causa |
|---|---|
| Visita duplicada | `insert` em vez de `upsert`, ou `id` gerado no servidor |
| Agendamento perdido | Interface esperando a rede em vez de gravar local primeiro |
| Escrita some sem erro | RLS barrou no `with check` — confira o `representante_id` |
| Sincroniza e para | Fila quebrando no primeiro erro sem retomar (`break` sem retry) |
| `.ics` recusado | Quebra de linha `\n` em vez de `\r\n` |
| Priorização ignorada | Não mostra o motivo da ordem |
