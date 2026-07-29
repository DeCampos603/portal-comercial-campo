# 06 — Agenda de visitas

## O problema real

O representante tem **328 clientes** e visita talvez 8 por dia. A pergunta que a agenda
responde não é *"o que tenho hoje?"* — é **"quem eu deveria estar visitando?"**.

Uma agenda que só mostra compromissos já marcados resolve metade do problema. A outra
metade é **decidir o que marcar**. É aí que a agenda se conecta ao mapa e à carteira.

## Modelo de dados

```js
// Uma visita
{
  "id": "vis_20260803_21142",              // <prefixo>_<data>_<códigoCliente>
  "codigoCliente": "21142",
  "nomeCliente": "CLIMA NORTE REFRIGERACAO LTDA",   // desnormalizado: relatório legível
  "data": "2026-08-03",
  "hora": "10:30",                          // null = sem hora marcada
  "duracaoMinutos": 45,
  "status": "agendada",                     // agendada | realizada | cancelada | remarcada
  "objetivo": "reativacao",                 // reativacao | cobranca | prospeccao | pos_venda | entrega
  "observacoes": "Falar com o Sr. Fulano sobre a linha de capacitores",
  "resultado": null,                        // preenchido depois da visita
  "cotacaoGerada": null,                    // id da cotação, se houver
  "criadoEm": "2026-07-27T14:32:00-03:00",
  "atualizadoEm": "2026-07-27T14:32:00-03:00"
}

// Resultado (preenchido após a visita — é aqui que a agenda vira inteligência)
"resultado": {
  "compareceu": true,
  "desfecho": "pedido",        // pedido | orcamento | sem_interesse | fechado | retornar
  "valorCentavos": 145000,
  "proximoPasso": "Retornar em 15 dias com amostra",
  "proximaData": "2026-08-18"
}
```

## Sincronização (Supabase)

Os agendamentos vivem na tabela `visitas` do Supabase, isolados por `representante_id`
via RLS. Esquema em `modelos/supabase/01-schema.sql`; detalhes em
`10-supabase-auth-e-dados.md`.

Vantagens: sincroniza PC ↔ celular, cada representante só enxerga a própria agenda
(garantido pelo banco, não pelo frontend), e o gatilho `visitas_marca_ultima` atualiza
o `ultima_visita` do cliente sozinho.

### Escrita offline (requisito, não enfeite)

O representante agenda **dentro da loja do cliente**, onde muitas vezes não há sinal.
Perder um agendamento é inaceitável.

```js
// Toda escrita passa pela fila. A interface NUNCA espera a rede.
async function salvarVisita(visita) {
  visita.atualizadoEm = new Date().toISOString();

  await filaLocal.gravar(visita);        // 1. IndexedDB — instantâneo
  atualizarInterface(visita);            // 2. tela responde já
  sincronizar();                         // 3. envia em segundo plano (sem await)

  return visita;
}

async function sincronizar() {
  if (!navigator.onLine) return;         // volta quando a rede voltar
  const pendentes = await filaLocal.pendentes();

  for (const visita of pendentes) {
    try {
      // upsert por id (gerado no cliente) — reenvio nunca duplica
      const { error } = await supabase.from('visitas').upsert(visita);
      if (error) throw error;
      await filaLocal.marcarSincronizada(visita.id);
    } catch (erro) {
      // Mantém na fila e para. Não martele um servidor que está fora.
      // ⚠️ Erro de auth aqui é OFFLINE, não motivo para deslogar.
      console.warn('Sincronização adiada:', erro);
      break;
    }
  }
  atualizarIndicadorSincronizacao();
}

window.addEventListener('online', sincronizar);
```

**Indicador sempre visível:** `✅ Sincronizado` · `🔄 Enviando…` · `⏳ 3 pendentes` ·
`⚠️ Falha — toque para tentar`. O usuário precisa saber se o trabalho dele está seguro.

### Resolução de conflito

Duas telas abertas, ou edição direto no painel do Supabase. Regra: **quem escreveu por
último vence** (`atualizado_em`). Perder um dado por merge automático é pior que ter dois
— se um caso real aparecer, registre a versão perdedora antes de sobrescrever.

## Interfaces (três visões, três perguntas)

### 1. Hoje — "o que eu faço agora?"

Tela de abertura no celular. Só o essencial:

```
┌───────────────────────────────────────┐
│  SEGUNDA, 3 DE AGOSTO                 │
│  5 visitas · Corredor Leopoldina      │
├───────────────────────────────────────┤
│ ✅ 09:00  CLIMA NORTE          Realizada│
│           → Pedido R$ 1.450           │
├───────────────────────────────────────┤
│ ▶ 10:30  MERCANTIL DO FRIO               │
│    Bonsucesso · 🟢 Sem Título         │
│    Reativação                         │
│    [Cheguei] [Ligar] [Rota] [Cotar]   │
├───────────────────────────────────────┤
│   14:00  TECNOAR SERVICOS          │
│   16:00  ELETRO CENTRO                │
└───────────────────────────────────────┘
```

O botão **[Cheguei]** marca presença e abre o formulário de resultado. Registrar o
desfecho tem que custar 10 segundos, ou não será feito — e sem resultado, a agenda vira
só um calendário bonito.

### 2. Semana — "meu plano está equilibrado?"

Grade de 7 dias, mostrando carga por dia e **região dominante**. Alerta quando o dia
mistura corredores incompatíveis: *"Terça tem visita em Campo Grande e em Niterói —
2h de deslocamento entre elas."* Esse aviso sozinho já paga o projeto.

### 3. Planejar — "quem eu deveria visitar?"

A tela mais valiosa. Fila priorizada de quem **não** está agendado:

```js
/**
 * Pontua um cliente para priorizar a fila de visitação.
 * Pesos são um ponto de partida — ajuste com o usuário depois de usar de verdade.
 */
function pontuarPrioridade(cliente, contexto) {
  let pontos = 0;

  // Tempo sem visita: o fator mais forte
  const dias = diasDesde(cliente.ultimaVisita) ?? 999;
  pontos += Math.min(dias / 30, 12) * 10;          // teto em ~1 ano

  // Situação comercial
  if (cliente.origem === 'recuperacao') pontos += 40;   // já em processo: não perder
  if (cliente.status === 'Atrasado')    pontos += 25;   // precisa de conversa
  if (cliente.status === 'Com Título')  pontos += 10;

  // Proximidade do corredor já planejado para o dia
  if (contexto.corredorDoDia === cliente.regiao) pontos += 35;

  // Cliente que já comprou vale mais que um que nunca comprou
  if (cliente.ultimaCompra) pontos += 20;

  return Math.round(pontos);
}
```

Interface: lista ordenada, com o **motivo** ao lado de cada um ("187 dias sem visita ·
em recuperação · no corredor de terça"). Arrastar para o dia agenda. Explicar o porquê
é o que faz o usuário confiar na ordenação em vez de ignorá-la.

## Integração com os outros módulos

| De | Para | O que acontece |
|---|---|---|
| Mapa → Agenda | Pino → "Agendar visita" | Abre o formulário com o cliente preenchido |
| Agenda → Mapa | Dia → "Ver no mapa" | Plota só as visitas daquele dia, na ordem |
| Agenda → Cotações | Visita → "Nova cotação" | Abre a cotação com o cabeçalho do cliente pronto |
| Cotações → Agenda | Cotação salva | Vincula à visita e marca desfecho "orçamento" |
| Agenda → Carteira | Visita realizada | Atualiza `ultimaVisita` do cliente |

Esse ciclo fechado é a diferença entre quatro ferramentas soltas e **um sistema**.

## Lembretes sem backend

Não há servidor para disparar notificação. O que dá para fazer num site estático:

1. **Notification API** enquanto a aba está aberta — funciona, mas exige o app aberto.
2. **Exportar `.ics`** — gera um arquivo de calendário que o usuário importa no Google
   Calendar/Outlook, e aí sim recebe alerta no celular. **É a solução recomendada.**
3. Botão "Exportar semana para o meu calendário" → um `.ics` com todas as visitas.

```js
function gerarICS(visitas) {
  const escapar = (t) => String(t ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const paraUTC = (data, hora) =>
    new Date(`${data}T${hora || '09:00'}:00-03:00`)
      .toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const eventos = visitas.map(v => [
    'BEGIN:VEVENT',
    `UID:${v.id}@portal-comercial`,
    `DTSTART:${paraUTC(v.data, v.hora)}`,
    `DTEND:${paraUTC(v.data, somarMinutos(v.hora, v.duracaoMinutos))}`,
    `SUMMARY:Visita — ${escapar(v.nomeCliente)}`,
    `DESCRIPTION:${escapar(v.observacoes)}`,
    `LOCATION:${escapar(v.enderecoCompleto)}`,
    'BEGIN:VALARM',            // alerta 30 min antes
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Visita em 30 min — ${escapar(v.nomeCliente)}`,
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n'));

  return ['BEGIN:VCALENDAR', 'VERSION:2.0',
          'PRODID:-//Portal Comercial de Campo//PT-BR',
          ...eventos, 'END:VCALENDAR'].join('\r\n');
}
```

> O padrão iCalendar (RFC 5545) exige quebra de linha `\r\n`. Com `\n` puro, o Outlook
> recusa o arquivo silenciosamente.

## Relatórios que a agenda passa a permitir

Com histórico de visitas e desfechos, coisas que hoje não existem:

- **Taxa de conversão por objetivo** — quanto de reativação vira pedido?
- **Visitas por corredor / mês** — onde está o esforço vs. onde está o retorno.
- **Clientes reativados** — quem estava inativo e voltou a comprar. É o KPI do trabalho.
- **Tempo médio até reativar** — quantas visitas até o primeiro pedido.
- **Cobertura da carteira** — % dos 328 visitados nos últimos 90 dias.

Comece simples: `Visitas no mês` · `Realizadas / agendadas` · `Pedidos gerados` ·
`Valor total`. Só acrescente relatório quando o dado existir de verdade — painel
bonito com número inventado é pior que painel nenhum.
