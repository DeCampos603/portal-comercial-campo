/**
 * Carteira — os 328 clientes pesquisáveis, filtráveis e acionáveis.
 *
 * O campo `contato` vem 100% vazio da origem (nenhum dos 328 tem nome de
 * pessoa). Preenchê-lo aqui é o que transforma a carteira de foto morta em
 * sistema vivo: vender é para pessoas, não para CNPJs.
 */

import { estado, aoMudar, salvarCliente, cotacoesDoCliente, recursos } from '../nucleo/dados.js';
import { abrirFormularioCliente, formatarCNPJ, digitosCNPJ } from './formulario.js';
import { criarIndice, buscar, comAtraso, normalizar } from '../nucleo/busca.js';
import { formatarData, diasDesde, formatarBRL } from '../nucleo/moeda.js';
import { esc, vazio, seloStatus, linkContato, linkRota, enderecoLinha, abrirPainel, avisar } from '../nucleo/ui.js';

/** Filtros compartilhados com o mapa — filtrar aqui reflete lá. */
export const filtros = {
  texto: '', status: new Set(), origem: new Set(), cidade: '', semVisita: false,
};

let indice = null;

export function montarCarteira(alvo) {
  const soltar = aoMudar(() => desenhar(alvo));
  desenhar(alvo);
  return soltar;
}

export function clientesFiltrados() {
  let lista = estado.clientes;

  if (filtros.texto.trim()) {
    if (!indice || indice.length !== estado.clientes.length) {
      indice = criarIndice(estado.clientes, (c) =>
        [c.nome, c.codigo, digitosCNPJ(c.cnpj), c.bairro, c.cidade, c.contato, c.email]);
    }
    lista = buscar(indice, filtros.texto, 2000);
  }

  return lista.filter((c) => {
    if (filtros.status.size && !filtros.status.has(c.status)) return false;
    if (filtros.origem.size && !filtros.origem.has(c.origem)) return false;
    if (filtros.cidade && normalizar(c.cidade) !== normalizar(filtros.cidade)) return false;
    if (filtros.semVisita && c.ultima_visita) return false;
    return true;
  });
}

function desenhar(alvo) {
  if (!estado.clientes.length) {
    alvo.innerHTML = vazio('👥', 'Carteira não carregada',
      estado.erro || 'Aguardando dados do servidor.');
    return;
  }

  const lista = clientesFiltrados();
  const cidades = [...new Set(estado.clientes.map((c) => c.cidade).filter(Boolean))].sort();

  alvo.innerHTML = `
    <div class="cartao" style="margin-bottom:12px">
      <div class="cartao__corpo" style="padding:12px 16px">
        <div class="linha" style="gap:10px;flex-wrap:wrap">
          <div class="campo-busca" style="flex:1;min-width:200px">
            <input class="campo" id="car-busca" type="search" autocomplete="off"
                   value="${esc(filtros.texto)}"
                   placeholder="Nome, código, bairro, cidade…" aria-label="Buscar cliente">
          </div>
          <select class="campo" id="car-cidade" style="width:auto;min-width:150px">
            <option value="">Todas as cidades</option>
            ${cidades.map((c) => `<option ${c === filtros.cidade ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="linha" style="gap:14px;flex-wrap:wrap;margin-top:10px">
          ${['Atrasado', 'Com Título', 'Sem Título'].map((s) => `
            <label class="linha pequeno" style="gap:5px;cursor:pointer">
              <input type="checkbox" data-status="${esc(s)}" ${filtros.status.has(s) ? 'checked' : ''}>
              ${seloStatus(s)}
            </label>`).join('')}
          <span style="width:1px;height:18px;background:var(--cor-borda)"></span>
          ${[['inativo', 'Inativos'], ['recuperacao', 'Em recuperação']].map(([v, r]) => `
            <label class="linha pequeno" style="gap:5px;cursor:pointer">
              <input type="checkbox" data-origem="${v}" ${filtros.origem.has(v) ? 'checked' : ''}> ${r}
            </label>`).join('')}
          <label class="linha pequeno" style="gap:5px;cursor:pointer">
            <input type="checkbox" id="car-sem-visita" ${filtros.semVisita ? 'checked' : ''}>
            Nunca visitados
          </label>
        </div>
      </div>
    </div>

    <div class="cartao">
      <div class="cartao__cabecalho">
        <h2 style="flex:1">Clientes</h2>
        <span class="pequeno suave">${lista.length} de ${estado.clientes.length}</span>
        <button class="btn btn--pequeno btn--primario" id="car-novo">+ Novo cliente</button>
      </div>
      ${lista.length ? tabela(lista) : vazio('🔍', 'Nenhum cliente com esses filtros',
        'Ajuste a busca ou limpe os filtros.')}
    </div>`;

  ligar(alvo);
}

function tabela(lista) {
  // Virtualização simples: 328 linhas renderizam bem, mas cortamos por
  // segurança caso a carteira cresça. O contador acima mostra o total real.
  const LIMITE = 300;
  const visiveis = lista.slice(0, LIMITE);

  const linhas = visiveis.map((c) => {
    const dias = diasDesde(c.ultima_visita);
    return `<tr data-cliente="${esc(c.id)}" style="cursor:pointer">
      <td>
        <div class="forte">${esc(c.nome)}</div>
        <div class="minusculo suave">${esc(c.codigo)}${
          c.cnpj ? ` · ${esc(formatarCNPJ(c.cnpj))}` : ''}${
          c.contato ? ` · ${esc(c.contato)}` : ''}</div>
      </td>
      <td>${seloStatus(c.status)}
        ${c.origem === 'recuperacao' ? '<span class="selo selo--info">⭐ recuperação</span>' : ''}</td>
      <td class="pequeno">${esc(c.bairro || '')}<div class="minusculo suave">${esc(c.cidade || '')}</div></td>
      <td class="pequeno">${esc(c.telefone || '—')}</td>
      <td class="pequeno">${c.ultima_visita
        ? `${formatarData(c.ultima_visita)}<div class="minusculo suave">há ${dias} dias</div>`
        : '<span class="suave">nunca</span>'}</td>
    </tr>`;
  }).join('');

  return `<div class="rolagem">
    <table class="tabela">
      <thead><tr>
        <th>Cliente</th><th>Situação</th><th>Local</th><th>Telefone</th><th>Última visita</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    ${lista.length > LIMITE
      ? `<p class="pequeno suave" style="padding:12px;margin:0">
           Mostrando ${LIMITE} de ${lista.length}. Refine a busca para ver os demais.</p>`
      : ''}
  </div>`;
}

function ligar(alvo) {
  const redesenhar = () => desenhar(alvo);

  const busca = alvo.querySelector('#car-busca');
  const aplicar = comAtraso((v) => { filtros.texto = v; redesenhar(); }, 140);
  busca?.addEventListener('input', (e) => aplicar(e.target.value));

  alvo.querySelector('#car-cidade')?.addEventListener('change', (e) => {
    filtros.cidade = e.target.value; redesenhar();
  });
  alvo.querySelectorAll('[data-status]').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? filtros.status.add(cb.dataset.status) : filtros.status.delete(cb.dataset.status);
      redesenhar();
    }));
  alvo.querySelectorAll('[data-origem]').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? filtros.origem.add(cb.dataset.origem) : filtros.origem.delete(cb.dataset.origem);
      redesenhar();
    }));
  alvo.querySelector('#car-sem-visita')?.addEventListener('change', (e) => {
    filtros.semVisita = e.target.checked; redesenhar();
  });

  alvo.querySelector('#car-novo')?.addEventListener('click', () =>
    abrirFormularioCliente(null, () => redesenhar()));

  alvo.querySelectorAll('[data-cliente]').forEach((linha) =>
    linha.addEventListener('click', () => abrirFicha(linha.dataset.cliente)));

  // Devolve o cursor ao fim do texto após o redesenho
  if (busca && document.activeElement !== busca && filtros.texto) {
    busca.focus();
    busca.setSelectionRange(busca.value.length, busca.value.length);
  }
}

// -------------------------------------------------------------- ficha

export function abrirFicha(id) {
  const c = estado.clientes.find((x) => x.id === id);
  if (!c) return;

  const visitas = estado.visitas
    .filter((v) => v.cliente_id === c.id)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));

  const precisao = { rua: 'nível de rua', bairro: 'aproximado (bairro)', cidade: 'muito aproximado' };

  const cotacoes = cotacoesDoCliente(c.id);

  abrirPainel(c.nome, `
    <div class="grade">
      <div>${seloStatus(c.status)}
        ${c.origem === 'recuperacao' ? '<span class="selo selo--info">⭐ em recuperação</span>' : ''}
        <span class="selo">${esc(c.codigo)}</span></div>

      <div class="pequeno">
        ${c.cnpj
          ? `🏢 CNPJ ${esc(formatarCNPJ(c.cnpj))}${
              c.inscricao_estadual ? ` · I.E. ${esc(c.inscricao_estadual)}` : ''}<br>`
          : '<span style="color:var(--cor-atencao)">⚠️ Sem CNPJ cadastrado</span><br>'}
        📍 ${esc(enderecoLinha(c))}<br>
        ${c.cep ? `CEP ${esc(c.cep)}` : ''}
        ${c.geo_precisao ? `<span class="suave"> · localização ${esc(precisao[c.geo_precisao] ?? c.geo_precisao)}</span>` : ''}
      </div>

      <div class="pequeno">
        ${c.telefone ? `📞 ${esc(c.telefone)}<br>` : ''}
        ${c.email ? `✉️ <span class="quebrar">${esc(c.email)}</span>` : ''}
      </div>

      <div class="linha" style="flex-wrap:wrap;gap:6px">
        ${linkContato(c)} ${linkRota(c)}
        <button class="btn btn--pequeno" id="ficha-editar">✏️ Editar cadastro</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--cor-borda)">

      <div>
        <label class="rotulo" for="ficha-contato">Contato (nome da pessoa)</label>
        <input class="campo" id="ficha-contato" value="${esc(c.contato || '')}"
               placeholder="Com quem você fala nesse cliente?">
      </div>
      <div>
        <label class="rotulo" for="ficha-notas">Notas</label>
        <textarea class="campo" id="ficha-notas" rows="4"
          placeholder="O que precisa lembrar na próxima visita?">${esc(c.notas || '')}</textarea>
      </div>
      <button class="btn btn--primario" id="ficha-salvar">Salvar</button>

      <hr style="border:none;border-top:1px solid var(--cor-borda)">

      ${blocoHistoricoCotacoes(cotacoes)}

      <hr style="border:none;border-top:1px solid var(--cor-borda)">

      <div>
        <h3>Histórico de visitas</h3>
        ${visitas.length ? `<ul style="margin:0;padding-left:18px" class="pequeno">
          ${visitas.slice(0, 12).map((v) => `<li>
            ${formatarData(v.data)} — ${esc(v.status)}
            ${v.resultado?.desfecho ? ` · ${esc(v.resultado.desfecho)}` : ''}
          </li>`).join('')}
        </ul>` : '<p class="pequeno suave">Nenhuma visita registrada.</p>'}
      </div>
    </div>`);

  document.getElementById('ficha-editar').addEventListener('click', () =>
    abrirFormularioCliente(c, () => abrirFicha(c.id)));

  document.getElementById('ficha-salvar').addEventListener('click', async () => {
    await salvarCliente({
      id: c.id,
      contato: document.getElementById('ficha-contato').value.trim() || null,
      notas: document.getElementById('ficha-notas').value.trim() || null,
    });
    avisar('Salvo.', 'info');
  });
}

/**
 * Histórico de cotações do cliente.
 *
 * Além da lista, calcula o ritmo de compra: com 2+ cotações dá para estimar
 * o intervalo médio e dizer se o cliente está atrasado em relação ao próprio
 * padrão. É a base do alarme de recompra que o usuário pediu para o futuro —
 * aqui aparece como observação, ainda sem disparar nada.
 */
function blocoHistoricoCotacoes(cotacoes) {
  if (!recursos.cotacoes) {
    return `<div>
      <h3>Cotações</h3>
      <p class="pequeno suave">
        Histórico indisponível: falta aplicar a migração
        <code>03-cnpj-e-cotacoes.sql</code> no Supabase.
      </p>
    </div>`;
  }

  if (!cotacoes.length) {
    return `<div>
      <h3>Cotações</h3>
      <p class="pequeno suave">Nenhuma cotação registrada para este cliente.</p>
    </div>`;
  }

  const total = cotacoes.reduce((a, c) => a + (c.total_com_ipi_centavos || 0), 0);
  const ticket = Math.round(total / cotacoes.length);
  const diasUltima = diasDesde(cotacoes[0].data);

  // Intervalo médio entre cotações: só faz sentido com pelo menos duas.
  let previsao = '';
  if (cotacoes.length > 1) {
    const primeira = new Date(`${cotacoes[cotacoes.length - 1].data}T12:00`);
    const ultima = new Date(`${cotacoes[0].data}T12:00`);
    const intervalo = Math.round(
      (ultima - primeira) / 86400000 / (cotacoes.length - 1));

    if (intervalo > 0) {
      const atraso = diasUltima - intervalo;
      previsao = atraso > 0
        ? `<div class="faixa faixa--atencao pequeno" style="margin:8px 0 0">
             ⏰ Costuma cotar a cada ~${intervalo} dias, e já se passaram
             ${diasUltima}. Está ${atraso} dia(s) além do próprio ritmo.
           </div>`
        : `<div class="faixa pequeno" style="margin:8px 0 0">
             📆 Costuma cotar a cada ~${intervalo} dias. Próxima prevista
             em ~${Math.abs(atraso)} dia(s).
           </div>`;
    }
  }

  return `<div>
    <h3>Cotações</h3>
    <div class="linha pequeno" style="gap:14px;flex-wrap:wrap;margin-bottom:6px">
      <span><strong>${cotacoes.length}</strong> cotação(ões)</span>
      <span>Total <strong>${formatarBRL(total)}</strong></span>
      <span>Ticket médio <strong>${formatarBRL(ticket)}</strong></span>
    </div>
    ${previsao}
    <ul style="margin:8px 0 0;padding-left:18px" class="pequeno">
      ${cotacoes.slice(0, 10).map((c) => `<li>
        ${formatarData(c.data)} — <strong>${formatarBRL(c.total_com_ipi_centavos)}</strong>
        · ${c.quantidade_itens} item(ns)
        ${c.numero ? ` · nº ${esc(c.numero)}` : ''}
      </li>`).join('')}
    </ul>
    ${cotacoes.length > 10
      ? `<p class="minusculo suave" style="margin:6px 0 0">
           e mais ${cotacoes.length - 10} anteriores.</p>`
      : ''}
  </div>`;
}
