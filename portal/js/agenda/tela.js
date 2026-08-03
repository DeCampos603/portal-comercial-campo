/**
 * Agenda — não é um calendário.
 *
 * Com 328 clientes e ~8 visitas por dia, a pergunta difícil não é "o que tenho
 * hoje?", é "quem eu deveria estar visitando?". Por isso a aba "Planejar"
 * pesa tanto quanto a "Hoje" — e sempre mostra o MOTIVO da ordem, senão o
 * usuário ignora a sugestão.
 */

import { estado, aoMudar, salvarVisita, excluirVisita } from '../nucleo/dados.js';
import { formatarData, formatarHora, hojeISO, diasDesde } from '../nucleo/moeda.js';
import { esc, vazio, seloStatus, ORIGENS, linkContato, linkRota, abrirPainel, avisar, confirmar } from '../nucleo/ui.js';
import { perfil } from '../supabase.js';

const OBJETIVOS = {
  reativacao: 'Reativação', cobranca: 'Cobrança', prospeccao: 'Prospecção',
  pos_venda: 'Pós-venda', entrega: 'Entrega',
};
const DESFECHOS = {
  pedido: 'Pedido fechado', orcamento: 'Orçamento enviado',
  retornar: 'Retornar depois', sem_interesse: 'Sem interesse', fechado: 'Estava fechado',
};

let visao = 'hoje';           // hoje | semana | planejar
let alvoGlobal = null;

export function montarAgenda(alvo) {
  alvoGlobal = alvo;
  const soltar = aoMudar(() => desenhar(alvo));
  desenhar(alvo);
  return () => { soltar(); alvoGlobal = null; };
}

function desenhar(alvo) {
  alvo.innerHTML = `
    <div class="linha" style="gap:6px;margin-bottom:12px;flex-wrap:wrap">
      ${[['hoje', '📌 Hoje'], ['semana', '🗓️ Semana'], ['planejar', '🎯 Planejar']]
        .map(([v, r]) => `<button class="btn ${visao === v ? 'btn--primario' : ''}"
          data-visao="${v}">${r}</button>`).join('')}
      <span style="flex:1"></span>
      <button class="btn btn--pequeno" id="ag-ics">📥 Exportar semana</button>
    </div>
    <div id="ag-corpo"></div>`;

  const corpo = alvo.querySelector('#ag-corpo');
  if (visao === 'hoje') corpo.innerHTML = telaHoje();
  else if (visao === 'semana') corpo.innerHTML = telaSemana();
  else corpo.innerHTML = telaPlanejar();

  ligar(alvo);
}

// ------------------------------------------------------------- visões

function visitasDe(data) {
  return estado.visitas
    .filter((v) => v.data === data && v.status !== 'cancelada')
    .sort((a, b) => String(a.hora || '99').localeCompare(String(b.hora || '99')));
}

function telaHoje() {
  const hoje = hojeISO();
  const lista = visitasDe(hoje);

  if (!lista.length) {
    return `<div class="cartao">${vazio('📌', 'Nenhuma visita hoje',
      'Monte o dia a partir da fila de prioridade.',
      '<button class="btn btn--primario" data-visao="planejar">Planejar visitas</button>')}</div>`;
  }

  return `<div class="cartao">
    <div class="cartao__cabecalho">
      <h2 style="flex:1">${new Date(`${hoje}T12:00`).toLocaleDateString('pt-BR',
        { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
      <span class="pequeno suave">${lista.length} visita(s)</span>
    </div>
    <div>${lista.map(cartaoVisita).join('')}</div>
  </div>`;
}

function cartaoVisita(v) {
  const c = estado.clientes.find((x) => x.id === v.cliente_id);
  const realizada = v.status === 'realizada';

  return `<div style="padding:12px 16px;border-bottom:1px solid var(--cor-borda);
      ${realizada ? 'opacity:.72' : ''}">
    <div class="entre" style="align-items:flex-start">
      <div style="flex:1">
        <div class="linha" style="gap:8px">
          <span class="forte numero">${esc(formatarHora(v.hora))}</span>
          <span class="forte">${esc(v.nome_cliente || c?.nome || 'Cliente')}</span>
          ${realizada ? '<span class="selo selo--ok">✅ realizada</span>' : ''}
        </div>
        <div class="minusculo suave" style="margin-top:2px">
          ${c ? `${esc(c.bairro || '')} · ${esc(c.cidade || '')} · ` : ''}
          ${esc(OBJETIVOS[v.objetivo] || '')}
        </div>
        ${c ? `<div style="margin-top:4px">${seloStatus(c.status)}</div>` : ''}
        ${v.observacoes ? `<div class="pequeno" style="margin-top:6px">📝 ${esc(v.observacoes)}</div>` : ''}
        ${v.resultado ? `<div class="pequeno" style="margin-top:6px">
          → ${esc(DESFECHOS[v.resultado.desfecho] || v.resultado.desfecho || '')}
          ${v.resultado.proximoPasso ? ` · ${esc(v.resultado.proximoPasso)}` : ''}</div>` : ''}
      </div>
    </div>
    <div class="linha" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      ${realizada
        ? `<button class="btn btn--pequeno" data-resultado="${esc(v.id)}">Editar resultado</button>`
        : `<button class="btn btn--primario btn--pequeno" data-resultado="${esc(v.id)}">✓ Cheguei</button>`}
      ${c ? linkContato(c) : ''} ${c ? linkRota(c) : ''}
      <button class="btn btn--pequeno" data-editar="${esc(v.id)}">Editar</button>
      <button class="btn btn--pequeno btn--risco" data-excluir="${esc(v.id)}">Excluir</button>
    </div>
  </div>`;
}

function telaSemana() {
  const hoje = new Date(`${hojeISO()}T12:00`);
  const dias = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    dias.push(d.toISOString().slice(0, 10));
  }

  return `<div class="cartao"><div class="cartao__corpo grade">
    ${dias.map((data) => {
      const lista = visitasDe(data);
      const regioes = [...new Set(lista.map((v) => {
        const c = estado.clientes.find((x) => x.id === v.cliente_id);
        return c?.cidade;
      }).filter(Boolean))];

      // Aviso que sozinho já paga o projeto: dia com corredores incompatíveis.
      const disperso = regioes.length > 2;

      return `<div style="border:1px solid var(--cor-borda);border-radius:var(--raio);padding:10px">
        <div class="entre">
          <span class="forte">${new Date(`${data}T12:00`).toLocaleDateString('pt-BR',
            { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
          <span class="pequeno suave">${lista.length} visita(s)</span>
        </div>
        ${regioes.length ? `<div class="minusculo suave" style="margin-top:4px">${esc(regioes.join(' · '))}</div>` : ''}
        ${disperso ? `<div class="faixa faixa--atencao minusculo" style="margin:6px 0 0">
          ⚠️ ${regioes.length} regiões diferentes no mesmo dia — muito deslocamento.
        </div>` : ''}
        ${lista.length ? `<ul class="pequeno" style="margin:6px 0 0;padding-left:18px">
          ${lista.map((v) => `<li>${esc(formatarHora(v.hora))} ${esc(v.nome_cliente || '')}</li>`).join('')}
        </ul>` : ''}
      </div>`;
    }).join('')}
  </div></div>`;
}

/**
 * Pontuação da fila de visitação.
 * Os pesos são ponto de partida — ajustar com o usuário depois do uso real.
 */
function pontuar(cliente) {
  const motivos = [];
  let pontos = 0;

  const dias = diasDesde(cliente.ultima_visita);
  if (dias === null) { pontos += 90; motivos.push('nunca visitado'); }
  else { pontos += Math.min(dias / 30, 12) * 10; motivos.push(`${dias} dias sem visita`); }

  // Cliente ativo pesa MAIS que em recuperação: manter quem já compra custa
  // menos que reconquistar quem parou, e uma visita perdida aqui é receita
  // que estava garantida.
  const carteira = ORIGENS[cliente.origem];
  if (carteira?.prioridade) {
    pontos += carteira.prioridade;
    motivos.push(cliente.origem === 'ativo' ? 'cliente ativo' : 'em recuperação');
  }
  if (cliente.status === 'Atrasado') { pontos += 25; motivos.push('inadimplente'); }
  else if (cliente.status === 'Com Título') { pontos += 10; motivos.push('com título em aberto'); }

  return { pontos: Math.round(pontos), motivos };
}

function telaPlanejar() {
  const agendados = new Set(estado.visitas
    .filter((v) => v.status === 'agendada' && v.data >= hojeISO())
    .map((v) => v.cliente_id));

  const fila = estado.clientes
    .filter((c) => !agendados.has(c.id))
    .map((c) => ({ cliente: c, ...pontuar(c) }))
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 40);

  if (!fila.length) {
    return `<div class="cartao">${vazio('🎯', 'Carteira toda agendada', 'Bom trabalho.')}</div>`;
  }

  return `<div class="cartao">
    <div class="cartao__cabecalho">
      <h2 style="flex:1">Quem visitar</h2>
      <span class="pequeno suave">${agendados.size} já agendado(s)</span>
    </div>
    <p class="pequeno suave" style="padding:0 16px">
      Ordenado por urgência. O motivo aparece ao lado de cada um — confie ou ignore
      com conhecimento de causa.
    </p>
    <div class="rolagem">
      <table class="tabela">
        <thead><tr><th>Cliente</th><th>Por quê</th><th>Local</th><th></th></tr></thead>
        <tbody>${fila.map(({ cliente, motivos }) => `<tr>
          <td>
            <div class="forte">${esc(cliente.nome)}</div>
            <div style="margin-top:2px">${seloStatus(cliente.status)}</div>
          </td>
          <td class="pequeno suave">${esc(motivos.join(' · '))}</td>
          <td class="pequeno">${esc(cliente.bairro || '')}<div class="minusculo suave">${esc(cliente.cidade || '')}</div></td>
          <td><button class="btn btn--pequeno btn--primario" data-agendar="${esc(cliente.id)}">Agendar</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

// ------------------------------------------------------- formulários

export function agendarPara(clienteId, visitaExistente = null) {
  const c = estado.clientes.find((x) => x.id === clienteId)
    ?? estado.clientes.find((x) => x.id === visitaExistente?.cliente_id);
  const v = visitaExistente;

  abrirPainel(v ? 'Editar visita' : `Agendar — ${c?.nome ?? ''}`, `
    <div class="grade">
      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="ag-data">Data</label>
          <input class="campo" type="date" id="ag-data" value="${esc(v?.data || hojeISO())}">
        </div>
        <div>
          <label class="rotulo" for="ag-hora">Hora</label>
          <input class="campo" type="time" id="ag-hora" value="${esc(v?.hora ? formatarHora(v.hora) : '09:00')}">
        </div>
      </div>
      <div>
        <label class="rotulo" for="ag-objetivo">Objetivo</label>
        <select class="campo" id="ag-objetivo">
          ${Object.entries(OBJETIVOS).map(([k, r]) =>
            `<option value="${k}" ${v?.objetivo === k ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="rotulo" for="ag-obs">Observações</label>
        <textarea class="campo" id="ag-obs" rows="3"
          placeholder="Com quem falar, o que levar…">${esc(v?.observacoes || '')}</textarea>
      </div>
      <button class="btn btn--primario" id="ag-salvar">Salvar visita</button>
    </div>`);

  document.getElementById('ag-salvar').addEventListener('click', async () => {
    const data = document.getElementById('ag-data').value;
    if (!data) { avisar('Escolha a data.', 'atencao'); return; }

    const alvoCliente = c ?? estado.clientes.find((x) => x.id === clienteId);
    // id gerado no cliente: a fila offline pode reenviar sem duplicar.
    const id = v?.id ?? `vis_${data.replace(/-/g, '')}_${alvoCliente?.codigo ?? 'x'}_${Date.now().toString(36)}`;

    await salvarVisita({
      id,
      equipe_id: perfil()?.equipe_id,
      representante_id: perfil()?.id,
      cliente_id: alvoCliente?.id ?? null,
      nome_cliente: alvoCliente?.nome ?? null,
      data,
      hora: document.getElementById('ag-hora').value || null,
      status: v?.status ?? 'agendada',
      objetivo: document.getElementById('ag-objetivo').value,
      observacoes: document.getElementById('ag-obs').value.trim() || null,
      resultado: v?.resultado ?? null,
    });

    document.querySelector('.painel')?.remove();
    avisar('Visita salva.', 'info');
    location.hash = '#/agenda';
  });
}

function registrarResultado(visitaId) {
  const v = estado.visitas.find((x) => x.id === visitaId);
  if (!v) return;
  const r = v.resultado ?? {};

  abrirPainel(`Resultado — ${v.nome_cliente ?? ''}`, `
    <div class="grade">
      <div>
        <label class="rotulo" for="res-desfecho">O que aconteceu?</label>
        <select class="campo" id="res-desfecho">
          ${Object.entries(DESFECHOS).map(([k, rot]) =>
            `<option value="${k}" ${r.desfecho === k ? 'selected' : ''}>${rot}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="rotulo" for="res-valor">Valor do pedido (R$)</label>
        <input class="campo" type="number" id="res-valor" min="0" step="0.01"
               inputmode="decimal" placeholder="0,00"
               value="${r.valorCentavos ? (r.valorCentavos / 100).toFixed(2) : ''}">
      </div>
      <div>
        <label class="rotulo" for="res-proximo">Próximo passo</label>
        <input class="campo" id="res-proximo" value="${esc(r.proximoPasso || '')}"
               placeholder="Retornar em 15 dias com amostra">
      </div>
      <button class="btn btn--primario" id="res-salvar">Registrar</button>
      <p class="minusculo suave" style="margin:0">
        Registrar o desfecho alimenta a fila de prioridade e o histórico do cliente.
      </p>
    </div>`);

  document.getElementById('res-salvar').addEventListener('click', async () => {
    const valor = document.getElementById('res-valor').value;
    await salvarVisita({
      ...v,
      status: 'realizada',
      resultado: {
        compareceu: true,
        desfecho: document.getElementById('res-desfecho').value,
        valorCentavos: valor ? Math.round(Number(valor) * 100) : null,
        proximoPasso: document.getElementById('res-proximo').value.trim() || null,
      },
    });
    document.querySelector('.painel')?.remove();
    avisar('Resultado registrado.', 'info');
  });
}

// ---------------------------------------------------------------- ics

/**
 * Exporta a semana como arquivo de calendário.
 * Sem servidor não há como disparar notificação — mas o Google Calendar /
 * Outlook do celular avisam a partir do .ics.
 */
function exportarICS() {
  const hoje = hojeISO();
  const limite = new Date(`${hoje}T12:00`);
  limite.setDate(limite.getDate() + 7);
  const fim = limite.toISOString().slice(0, 10);

  const lista = estado.visitas.filter((v) =>
    v.data >= hoje && v.data <= fim && v.status === 'agendada');

  if (!lista.length) { avisar('Nenhuma visita agendada nos próximos 7 dias.', 'atencao'); return; }

  const escapar = (t) => String(t ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const paraUTC = (data, hora, somaMin = 0) => {
    const d = new Date(`${data}T${hora || '09:00'}:00-03:00`);
    d.setMinutes(d.getMinutes() + somaMin);
    return `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  };

  const eventos = lista.map((v) => {
    const c = estado.clientes.find((x) => x.id === v.cliente_id);
    return [
      'BEGIN:VEVENT',
      `UID:${v.id}@portal-comercial`,
      `DTSTAMP:${paraUTC(hoje, '00:00')}`,
      `DTSTART:${paraUTC(v.data, v.hora)}`,
      `DTEND:${paraUTC(v.data, v.hora, v.duracao_minutos || 45)}`,
      `SUMMARY:Visita — ${escapar(v.nome_cliente)}`,
      `DESCRIPTION:${escapar([OBJETIVOS[v.objetivo], v.observacoes].filter(Boolean).join(' — '))}`,
      `LOCATION:${escapar(c ? [c.logradouro, c.bairro, c.cidade, c.uf].filter(Boolean).join(', ') : '')}`,
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY',
      `DESCRIPTION:Visita em 30 min — ${escapar(v.nome_cliente)}`, 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });

  // O RFC 5545 exige \r\n. Com \n puro, o Outlook recusa em silêncio.
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Portal Comercial de Campo//PT-BR', 'CALSCALE:GREGORIAN',
    ...eventos, 'END:VCALENDAR'].join('\r\n');

  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `visitas-${hoje}.ics`;
  link.click();
  URL.revokeObjectURL(url);
  avisar(`${lista.length} visita(s) exportada(s).`, 'info');
}

// ------------------------------------------------------------ eventos

function ligar(alvo) {
  alvo.querySelectorAll('[data-visao]').forEach((b) =>
    b.addEventListener('click', () => { visao = b.dataset.visao; desenhar(alvo); }));

  alvo.querySelectorAll('[data-agendar]').forEach((b) =>
    b.addEventListener('click', () => agendarPara(b.dataset.agendar)));

  alvo.querySelectorAll('[data-resultado]').forEach((b) =>
    b.addEventListener('click', () => registrarResultado(b.dataset.resultado)));

  alvo.querySelectorAll('[data-editar]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = estado.visitas.find((x) => x.id === b.dataset.editar);
      if (v) agendarPara(v.cliente_id, v);
    }));

  alvo.querySelectorAll('[data-excluir]').forEach((b) =>
    b.addEventListener('click', async () => {
      const v = estado.visitas.find((x) => x.id === b.dataset.excluir);
      if (!v || !confirmar(`Excluir a visita a ${v.nome_cliente} em ${formatarData(v.data)}?`)) return;
      await excluirVisita(v.id);
      avisar('Visita excluída.', 'info');
    }));

  alvo.querySelector('#ag-ics')?.addEventListener('click', exportarICS);
}
