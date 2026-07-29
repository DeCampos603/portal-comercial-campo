/**
 * Tela de cotações — o módulo de maior uso diário.
 *
 * Meta: montar um pedido de 15 itens em menos de 2 minutos, sem tocar no mouse.
 * Ciclo: buscar → Enter (adiciona) → digitar qtd → Enter (volta à busca).
 *
 * 🚦 O semáforo de estoque aparece JÁ NA BUSCA, antes de o item entrar na
 *    cotação. Descobrir que a peça não existe depois de montar o pedido, na
 *    frente do cliente, é o que este módulo evita.
 */

import { estado, aoMudar } from '../nucleo/dados.js';
import { criarIndice, buscar, comAtraso } from '../nucleo/busca.js';
import { formatarBRL, formatarNumero, formatarPercentual, formatarData, hojeISO } from '../nucleo/moeda.js';
import { esc, avisar, vazio, confirmar } from '../nucleo/ui.js';
import { calcularLinha, calcularTotais, rotuloEstoque, sanitizarParaCliente } from './calculo.js';
import { gerarPedidoHTML } from './exportar.js';
import { empresa, pedido } from './dadosPedido.js';
import { abrirPainel } from '../nucleo/ui.js';
import { perfil } from '../supabase.js';

const RASCUNHO = 'cotacao_rascunho';

/** { codigoSigma -> quantidade } */
let itensDaCotacao = new Map();
let clienteId = null;
let observacoes = '';
let indice = null;
let resultadosBusca = [];
let selecionado = 0;
let soComEstoque = false;

// ------------------------------------------------------------ rascunho

function salvarRascunho() {
  try {
    localStorage.setItem(RASCUNHO, JSON.stringify({
      itens: [...itensDaCotacao], clienteId, observacoes, em: new Date().toISOString(),
    }));
  } catch { /* modo privativo: seguir sem rascunho */ }
}

function lerRascunho() {
  try {
    const bruto = localStorage.getItem(RASCUNHO);
    return bruto ? JSON.parse(bruto) : null;
  } catch { return null; }
}

function limparCotacao() {
  itensDaCotacao = new Map();
  clienteId = null;
  observacoes = '';
  localStorage.removeItem(RASCUNHO);
}

// ---------------------------------------------------------------- api

export function montarCotacoes(alvo) {
  const rascunho = lerRascunho();
  if (rascunho?.itens?.length && itensDaCotacao.size === 0) {
    itensDaCotacao = new Map(rascunho.itens);
    clienteId = rascunho.clienteId ?? null;
    observacoes = rascunho.observacoes ?? '';
  }

  alvo.innerHTML = esqueleto();
  const soltar = aoMudar(() => redesenhar(alvo));
  redesenhar(alvo);
  return soltar;
}

function esqueleto() {
  return `<div class="grade" style="gap:16px">
    <div class="esqueleto" style="height:38px"></div>
    <div class="esqueleto" style="height:200px"></div>
  </div>`;
}

// ------------------------------------------------------------ desenho

function redesenhar(alvo) {
  if (!estado.catalogo.length) {
    alvo.innerHTML = vazio('📦', 'Catálogo não carregado',
      estado.erro || 'Aguardando dados do servidor.');
    return;
  }

  if (!indice || indice.length !== estado.catalogo.length) {
    indice = criarIndice(estado.catalogo, (i) =>
      [i.codigo_sigma, i.codigo_fabricante, i.descricao, i.grupo]);
  }

  const cliente = estado.clientes.find((c) => c.id === clienteId) ?? null;
  const linhas = montarLinhas();
  const totais = calcularTotais(linhas);

  alvo.innerHTML = `
    ${window.__faixaEstado ?? ''}
    <div class="nao-imprimir">
      ${blocoCliente(cliente)}
      ${blocoBusca()}
      ${blocoLinhas(linhas, totais)}
      ${linhas.length ? blocoDadosPedido() : ''}
    </div>
    <div class="impressao-so" id="area-impressao"></div>`;

  ligarEventos(alvo);
}

function blocoCliente(cliente) {
  const opcoes = estado.clientes
    .map((c) => `<option value="${esc(c.id)}" ${c.id === clienteId ? 'selected' : ''}>
      ${esc(c.nome)} — ${esc(c.cidade || '')}</option>`).join('');

  return `<div class="cartao" style="margin-bottom:12px">
    <div class="cartao__corpo" style="padding:12px 16px">
      <label class="rotulo" for="cot-cliente">Cliente</label>
      <select class="campo" id="cot-cliente">
        <option value="">— selecione para preencher o cabeçalho do pedido —</option>
        ${opcoes}
      </select>
      ${cliente ? `<p class="minusculo suave" style="margin:6px 0 0">
        ${esc([cliente.logradouro, cliente.bairro, cliente.cidade, cliente.uf].filter(Boolean).join(', '))}
        ${cliente.cep ? ` · CEP ${esc(cliente.cep)}` : ''}
        ${cliente.telefone ? ` · ${esc(cliente.telefone)}` : ''}
      </p>` : ''}
    </div>
  </div>`;
}

function blocoBusca() {
  return `<div class="cartao" style="margin-bottom:12px">
    <div class="cartao__corpo" style="padding:12px 16px">
      <div class="linha" style="gap:12px;flex-wrap:wrap">
        <div class="campo-busca" style="flex:1;min-width:220px">
          <input class="campo" id="cot-busca" type="search" autocomplete="off"
                 placeholder="Buscar por código Sigma, código do fabricante ou descrição…"
                 aria-label="Buscar item" aria-describedby="cot-dica">
        </div>
        <label class="linha pequeno" style="gap:6px;cursor:pointer;white-space:nowrap">
          <input type="checkbox" id="cot-so-estoque" ${soComEstoque ? 'checked' : ''}>
          Só com estoque
        </label>
      </div>
      <p class="minusculo suave" id="cot-dica" style="margin:6px 0 0">
        <kbd>/</kbd> foca a busca · <kbd>↑</kbd><kbd>↓</kbd> navega ·
        <kbd>Enter</kbd> adiciona e pula para a quantidade
      </p>
      <div id="cot-resultados" style="margin-top:8px"></div>
    </div>
  </div>`;
}

function montarLinhas() {
  const porCodigo = new Map(estado.catalogo.map((i) => [i.codigo_sigma, i]));
  const linhas = [];
  for (const [codigo, qtd] of itensDaCotacao) {
    const item = porCodigo.get(codigo);
    if (item) linhas.push({ item, calculo: calcularLinha(item, qtd) });
  }
  return linhas;
}

function blocoLinhas(linhas, totais) {
  if (!linhas.length) {
    return `<div class="cartao">${vazio('🧾', 'Cotação vazia',
      'Busque um item acima e pressione Enter para começar.')}</div>`;
  }

  const corpo = linhas.map(({ item, calculo }) => {
    const est = rotuloEstoque(item.status_estoque);
    const excede = item.saldo != null && calculo.qtd > item.saldo;
    return `<tr data-codigo="${esc(item.codigo_sigma)}">
      <td>
        <div class="forte">${esc(item.codigo_sigma)}</div>
        <div class="minusculo suave">${esc(item.codigo_fabricante || '')}</div>
      </td>
      <td>
        <div>${esc(item.descricao)}</div>
        <div class="minusculo" style="margin-top:2px">
          <span class="selo selo--${est.classe} selo-estoque">${est.icone} ${esc(est.texto)}${
            item.saldo != null ? ` · ${formatarNumero(item.saldo)} un.` : ''}</span>
          ${item.st ? '<span class="selo selo--info" title="Sujeito a apuração — consultar Sigma">ST</span>' : ''}
          ${excede ? `<span class="selo selo--risco">⚠️ pediu ${formatarNumero(calculo.qtd)}, há ${formatarNumero(item.saldo)}</span>` : ''}
        </div>
      </td>
      <td class="qtd" style="width:90px">
        <input class="campo" type="number" min="1" step="1" inputmode="numeric"
               value="${calculo.qtd}" data-qtd="${esc(item.codigo_sigma)}"
               aria-label="Quantidade de ${esc(item.codigo_sigma)}" style="text-align:right">
      </td>
      <td class="valor">${formatarBRL(item.valor_unitario_centavos)}</td>
      <td class="valor minusculo suave">${formatarPercentual(item.ipi)}</td>
      <td class="valor forte">${formatarBRL(calculo.valorComIpi)}</td>
      <td style="width:36px">
        <button class="btn btn--fantasma btn--pequeno" data-remover="${esc(item.codigo_sigma)}"
                aria-label="Remover ${esc(item.codigo_sigma)}">✕</button>
      </td>
    </tr>`;
  }).join('');

  const alertas = [];
  if (totais.itensSemEstoque)
    alertas.push(`<div class="faixa faixa--risco">🔴 ${totais.itensSemEstoque} item(ns) sem estoque nesta cotação.</div>`);
  if (totais.itensAcimaDoSaldo)
    alertas.push(`<div class="faixa faixa--atencao">⚠️ ${totais.itensAcimaDoSaldo} item(ns) com quantidade acima do saldo.</div>`);
  if (totais.itensEstoqueBaixo)
    alertas.push(`<div class="faixa faixa--atencao">🟡 ${totais.itensEstoqueBaixo} item(ns) com estoque acabando.</div>`);
  if (totais.itensSemPreco)
    alertas.push(`<div class="faixa faixa--risco">❓ ${totais.itensSemPreco} item(ns) sem preço — não entram no total.</div>`);

  return `<div class="cartao">
    <div class="cartao__cabecalho">
      <h2 style="flex:1">Itens da cotação</h2>
      <span class="pequeno suave">${totais.quantidadeItens} item(ns)</span>
      <button class="btn btn--pequeno btn--risco" id="cot-limpar">Limpar</button>
    </div>
    <div class="rolagem">
      <table class="tabela">
        <thead><tr>
          <th>Código</th><th>Descrição</th><th style="text-align:right">Qtd</th>
          <th style="text-align:right">Unitário</th><th style="text-align:right">IPI</th>
          <th style="text-align:right">Total c/ IPI</th><th></th>
        </tr></thead>
        <tbody>${corpo}</tbody>
      </table>
    </div>
    <div class="cartao__corpo">
      ${alertas.join('')}
      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="cot-obs">Observações</label>
          <textarea class="campo" id="cot-obs" rows="3"
            placeholder="Prazo combinado, condição de pagamento, referência…">${esc(observacoes)}</textarea>
        </div>
        <div>
          <table style="width:100%;font-size:.95rem">
            <tr><td class="suave">Total dos produtos</td>
                <td class="valor">${formatarBRL(totais.totalProdutos)}</td></tr>
            <tr><td class="suave">IPI</td>
                <td class="valor">${formatarBRL(totais.totalIpi)}</td></tr>
            <tr><td class="forte" style="padding-top:6px">Total com IPI</td>
                <td class="valor forte" style="font-size:1.15rem;padding-top:6px">
                  ${formatarBRL(totais.totalComIpi)}</td></tr>
          </table>
          <div class="linha linha--fim" style="margin-top:12px;gap:8px">
            <button class="btn" id="cot-imprimir">🖨️ PDF do cliente</button>
          </div>
          <p class="minusculo suave" style="margin:8px 0 0;text-align:right">
            O PDF não contém saldo, comissão nem categoria.
          </p>
        </div>
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------ dados do pedido

function blocoDadosPedido() {
  const p = pedido.ler();
  const faltando = empresa.pendencias();

  return `<div class="cartao" style="margin-top:12px">
    <div class="cartao__cabecalho">
      <h2 style="flex:1">Dados do pedido</h2>
      <button class="btn btn--pequeno" id="cot-empresa">⚙️ Dados da representação</button>
    </div>
    <div class="cartao__corpo">
      ${faltando.length ? `<div class="faixa faixa--atencao">
        ⚠️ Falta preencher ${esc(faltando.join(' e '))} da representação —
        o campo sai em branco no PDF. Clique em "Dados da representação".
      </div>` : ''}

      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="ped-numero">Pedido nº</label>
          <input class="campo" id="ped-numero" value="${esc(p.numero)}"
                 placeholder="Ex.: 001 ou MJ-0042">
          <label class="linha minusculo suave" style="gap:5px;margin-top:5px;cursor:pointer">
            <input type="checkbox" id="ped-auto" ${p.numeroAutomatico ? 'checked' : ''}>
            Avançar o número sozinho a cada pedido gerado
          </label>
        </div>
        <div>
          <label class="rotulo" for="ped-pagamento">Condições de pagamento</label>
          <input class="campo" id="ped-pagamento" value="${esc(p.condicoesPagamento)}"
                 placeholder="Ex.: 28/35/42 dias">
        </div>
        <div>
          <label class="rotulo" for="ped-prazo">Prazo de entrega</label>
          <input class="campo" id="ped-prazo" value="${esc(p.prazoEntrega)}"
                 placeholder="Ex.: 10 dias úteis">
        </div>
        <div>
          <label class="rotulo" for="ped-validade">Validade da cotação</label>
          <input class="campo" id="ped-validade" value="${esc(p.validade)}"
                 placeholder="Ex.: 7 dias">
        </div>
        <div>
          <label class="rotulo" for="ped-frete">Frete</label>
          <input class="campo" id="ped-frete" value="${esc(p.frete)}"
                 placeholder="Ex.: CIF ou FOB">
        </div>
      </div>

      <p class="minusculo suave" style="margin:10px 0 0">
        Estes valores ficam guardados e reaparecem na próxima cotação —
        só edite quando mudar.
      </p>
    </div>
  </div>`;
}

function abrirDadosEmpresa() {
  const e = empresa.ler();
  abrirPainel('Dados da representação', `
    <div class="grade">
      <p class="pequeno suave" style="margin:0">
        Aparecem no cabeçalho de todo pedido. Digite uma vez — ficam guardados
        neste navegador.
      </p>
      <div>
        <label class="rotulo" for="emp-razao">Razão social</label>
        <input class="campo" id="emp-razao" value="${esc(e.razaoSocial)}">
      </div>
      <div>
        <label class="rotulo" for="emp-cnpj">CNPJ</label>
        <input class="campo" id="emp-cnpj" value="${esc(e.cnpj)}"
               inputmode="numeric" placeholder="00.000.000/0000-00">
      </div>
      <div>
        <label class="rotulo" for="emp-ie">Inscrição Estadual</label>
        <input class="campo" id="emp-ie" value="${esc(e.inscricaoEstadual)}">
      </div>
      <div>
        <label class="rotulo" for="emp-fone">Telefone</label>
        <input class="campo" id="emp-fone" value="${esc(e.telefone)}"
               inputmode="tel" placeholder="(21) 00000-0000">
      </div>
      <div>
        <label class="rotulo" for="emp-email">E-mail</label>
        <input class="campo" id="emp-email" type="email" value="${esc(e.email)}">
      </div>
      <button class="btn btn--primario" id="emp-salvar">Salvar</button>
    </div>`);

  document.getElementById('emp-salvar').addEventListener('click', () => {
    empresa.gravar({
      razaoSocial: document.getElementById('emp-razao').value.trim(),
      cnpj: document.getElementById('emp-cnpj').value.trim(),
      inscricaoEstadual: document.getElementById('emp-ie').value.trim(),
      telefone: document.getElementById('emp-fone').value.trim(),
      email: document.getElementById('emp-email').value.trim(),
    });
    document.querySelector('.painel')?.remove();
    avisar('Dados da representação salvos.', 'info');
    redesenhar(document.getElementById('conteudo'));
  });
}

function guardarCampoPedido() {
  const valor = (id) => document.getElementById(id)?.value.trim() ?? '';
  pedido.gravar({
    numero: valor('ped-numero'),
    numeroAutomatico: document.getElementById('ped-auto')?.checked ?? true,
    condicoesPagamento: valor('ped-pagamento'),
    prazoEntrega: valor('ped-prazo'),
    validade: valor('ped-validade'),
    frete: valor('ped-frete'),
  });
}

// ---------------------------------------------------------- resultados

function desenharResultados() {
  const caixa = document.getElementById('cot-resultados');
  if (!caixa) return;

  if (!resultadosBusca.length) {
    caixa.innerHTML = '<p class="pequeno suave" style="margin:8px 0 0">Nenhum item encontrado.</p>';
    return;
  }

  caixa.innerHTML = `<div class="rolagem" style="max-height:280px;overflow-y:auto;
      border:1px solid var(--cor-borda);border-radius:var(--raio)">
    <table class="tabela">
      <tbody>${resultadosBusca.map((item, i) => {
        const est = rotuloEstoque(item.status_estoque);
        const jaTem = itensDaCotacao.has(item.codigo_sigma);
        return `<tr data-add="${esc(item.codigo_sigma)}" style="cursor:pointer;${
          i === selecionado ? 'background:var(--cor-primaria-clara)' : ''}">
          <td style="width:150px">
            <div class="forte">${esc(item.codigo_sigma)}</div>
            <div class="minusculo suave">${esc(item.codigo_fabricante || '')}</div>
          </td>
          <td>
            <div>${esc(item.descricao)}</div>
            <div class="minusculo" style="margin-top:2px">
              <span class="selo selo--${est.classe}">${est.icone} ${esc(est.texto)}${
                item.saldo != null ? ` · ${formatarNumero(item.saldo)} un.` : ''}</span>
              ${item.st ? '<span class="selo selo--info">ST</span>' : ''}
              ${jaTem ? '<span class="selo selo--info">já na cotação</span>' : ''}
            </div>
          </td>
          <td class="valor forte" style="width:110px">${formatarBRL(item.valor_unitario_centavos)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function rodarBusca(termo) {
  let base = indice;
  if (soComEstoque) {
    base = indice.filter((i) => i.registro.status_estoque !== 'sem_estoque');
  }
  resultadosBusca = termo.trim() ? buscar(base, termo, 40) : [];
  selecionado = 0;
  desenharResultados();
}

function adicionar(codigo) {
  const item = estado.catalogo.find((i) => i.codigo_sigma === codigo);
  if (!item) return;

  if (item.status_estoque === 'sem_estoque') {
    avisar(`${codigo} está sem estoque (${item.saldo ?? 0} un.). Adicionado mesmo assim — confira antes de enviar.`, 'risco', 4500);
  }
  if (!itensDaCotacao.has(codigo)) itensDaCotacao.set(codigo, 1);
  salvarRascunho();

  const alvo = document.getElementById('conteudo');
  redesenhar(alvo);

  // Foca a quantidade do item recém-adicionado — o ciclo de teclado.
  const campo = document.querySelector(`[data-qtd="${CSS.escape(codigo)}"]`);
  if (campo) { campo.focus(); campo.select(); }
}

// ------------------------------------------------------------ eventos

function ligarEventos(alvo) {
  const busca = alvo.querySelector('#cot-busca');
  if (busca) {
    const rodar = comAtraso((v) => rodarBusca(v), 110);
    busca.addEventListener('input', (e) => rodar(e.target.value));
    busca.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selecionado = Math.min(selecionado + 1, resultadosBusca.length - 1);
        desenharResultados();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selecionado = Math.max(selecionado - 1, 0);
        desenharResultados();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = resultadosBusca[selecionado];
        if (item) adicionar(item.codigo_sigma);
      } else if (e.key === 'Escape') {
        busca.value = ''; resultadosBusca = []; desenharResultados();
      }
    });
    if (resultadosBusca.length) desenharResultados();
  }

  alvo.querySelector('#cot-so-estoque')?.addEventListener('change', (e) => {
    soComEstoque = e.target.checked;
    rodarBusca(alvo.querySelector('#cot-busca').value);
  });

  alvo.querySelector('#cot-resultados')?.addEventListener('click', (e) => {
    const linha = e.target.closest('[data-add]');
    if (linha) adicionar(linha.dataset.add);
  });

  alvo.querySelector('#cot-cliente')?.addEventListener('change', (e) => {
    clienteId = e.target.value || null;
    salvarRascunho();
    redesenhar(alvo);
  });

  alvo.querySelectorAll('[data-qtd]').forEach((campo) => {
    campo.addEventListener('change', () => {
      const qtd = Math.max(1, Math.trunc(Number(campo.value) || 1));
      itensDaCotacao.set(campo.dataset.qtd, qtd);
      salvarRascunho();
      redesenhar(alvo);
    });
    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      campo.dispatchEvent(new Event('change'));
      const busca2 = document.getElementById('cot-busca');
      if (busca2) { busca2.focus(); busca2.select(); }
    });
  });

  alvo.querySelectorAll('[data-remover]').forEach((botao) => {
    botao.addEventListener('click', () => {
      itensDaCotacao.delete(botao.dataset.remover);
      salvarRascunho();
      redesenhar(alvo);
    });
  });

  alvo.querySelector('#cot-obs')?.addEventListener('input', (e) => {
    observacoes = e.target.value;
    salvarRascunho();
  });

  alvo.querySelector('#cot-limpar')?.addEventListener('click', () => {
    if (!confirmar(`Limpar a cotação com ${itensDaCotacao.size} item(ns)?`)) return;
    limparCotacao();
    redesenhar(alvo);
  });

  alvo.querySelector('#cot-imprimir')?.addEventListener('click', () => imprimir(alvo));
  alvo.querySelector('#cot-empresa')?.addEventListener('click', abrirDadosEmpresa);

  // Grava a cada digitação: o representante não deveria ter de "salvar" isto.
  ['ped-numero', 'ped-pagamento', 'ped-prazo', 'ped-validade', 'ped-frete']
    .forEach((id) => alvo.querySelector(`#${id}`)
      ?.addEventListener('input', guardarCampoPedido));
  alvo.querySelector('#ped-auto')?.addEventListener('change', guardarCampoPedido);
}

// --------------------------------------------------------- impressão

function imprimir(alvo) {
  const linhas = montarLinhas();
  if (!linhas.length) { avisar('A cotação está vazia.', 'atencao'); return; }

  const totais = calcularTotais(linhas);
  if (totais.itensSemEstoque &&
      !confirmar(`Esta cotação tem ${totais.itensSemEstoque} item(ns) SEM ESTOQUE.\n\nGerar o PDF assim mesmo?`)) {
    return;
  }

  guardarCampoPedido();

  const cliente = estado.clientes.find((c) => c.id === clienteId) ?? null;
  const cotacao = {
    data: hojeISO(),
    vendedor: perfil()?.nome ?? '',
    observacoes,
    empresa: empresa.ler(),
    pedido: pedido.ler(),
    cliente, linhas, totais,
  };

  // 🔒 Sanitiza ANTES de gerar o HTML: o dado interno nunca entra na página.
  const limpa = sanitizarParaCliente(cotacao);
  document.getElementById('area-impressao').innerHTML = gerarPedidoHTML(limpa);
  window.print();

  // Só avança a numeração depois de o pedido ter sido efetivamente gerado.
  pedido.avancarNumero();

  // ⚠️ NÃO redesenhar aqui. Um redesenho recria a área de impressão vazia, e
  // se o navegador imprimir de forma assíncrona sai uma folha em branco.
  // Atualiza apenas o campo do número, no lugar.
  const campoNumero = document.getElementById('ped-numero');
  if (campoNumero) campoNumero.value = pedido.ler().numero;
}

// Atalho global: "/" foca a busca de qualquer lugar da tela de cotações.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
  const dentroDeCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (dentroDeCampo) return;
  const busca = document.getElementById('cot-busca');
  if (busca) { e.preventDefault(); busca.focus(); busca.select(); }
});
