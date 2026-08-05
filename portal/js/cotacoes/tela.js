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

import { estado, aoMudar, salvarCotacao, recursos } from '../nucleo/dados.js';
import { imprimirHTML } from './impressao.js';
import { criarIndice, buscar, comAtraso } from '../nucleo/busca.js';
import { formatarBRL, formatarNumero, formatarPercentual, formatarData, hojeISO } from '../nucleo/moeda.js';
import { esc, avisar, vazio, confirmar, seloStatus, abrirPainel } from '../nucleo/ui.js';
import { abrirFormularioCliente, formatarCNPJ, digitosCNPJ } from '../carteira/formulario.js';
import { calcularLinha, calcularTotais, rotuloEstoque, sanitizarParaCliente } from './calculo.js';
import { gerarPedidoHTML } from './exportar.js';
import { empresa, pedido } from './dadosPedido.js';
import { historicoDoItem, seloHistorico, itensParaRepor } from './historicoItem.js';
import { validadeCotacao } from '../nucleo/diasUteis.js';
import { perfil } from '../supabase.js';

const RASCUNHO = 'cotacao_rascunho';

/** { codigoSigma -> quantidade } */
let itensDaCotacao = new Map();
let clienteId = null;

/**
 * Identidade da cotação que está sendo montada.
 *
 * 🔴 Sem isto, salvar e depois gerar o PDF criava DOIS registros do mesmo
 *    documento no histórico — um por clique. Com o id fixo, o segundo grava
 *    por cima do primeiro e só promove a situação de rascunho para enviada.
 *
 *    Vive no rascunho junto com os itens: recarregar a página no meio do
 *    trabalho não pode transformar a cotação em uma segunda cotação.
 *
 *    Zerado ao limpar e ao "refazer" a partir do histórico — nos dois casos
 *    o que começa ali é um documento novo, não a edição de um antigo.
 */
let cotacaoId = null;
let observacoes = '';
let indice = null;
let indiceClientes = null;
let resultadosBusca = [];
let selecionado = 0;
let soComEstoque = false;

// ------------------------------------------------------------ rascunho

function salvarRascunho() {
  try {
    localStorage.setItem(RASCUNHO, JSON.stringify({
      itens: [...itensDaCotacao], clienteId, observacoes, cotacaoId,
      em: new Date().toISOString(),
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
  cotacaoId = null;          // o que vier depois é documento novo
  localStorage.removeItem(RASCUNHO);
}

// ---------------------------------------------------------------- api

/**
 * Carrega uma cotação salva de volta na tela, para refazer o pedido.
 *
 * ⚠️ Traz as QUANTIDADES do histórico, mas os PREÇOS de hoje — é o certo para
 *    quem vai emitir um pedido novo. Quem quer o documento como foi enviado
 *    usa "Gerar PDF" no histórico, que sai da fotografia e não passa por aqui.
 *
 * @returns {{carregados: number, ausentes: string[]}} item que saiu do
 *   catálogo não pode ser cotado — some da lista, e o chamador avisa quais.
 */
export function carregarNaCotacao(cotacaoSalva) {
  const noCatalogo = new Set(estado.catalogo.map((i) => i.codigo_sigma));
  const ausentes = [];

  itensDaCotacao = new Map();
  for (const item of cotacaoSalva.itens ?? []) {
    if (noCatalogo.has(item.codigo_sigma)) {
      itensDaCotacao.set(item.codigo_sigma, item.quantidade);
    } else {
      ausentes.push(item.codigo_sigma);
    }
  }

  clienteId = cotacaoSalva.cliente_id ?? null;
  observacoes = cotacaoSalva.observacoes ?? '';
  // Documento NOVO, não edição do antigo: a cotação de origem continua no
  // histórico exatamente como foi enviada.
  cotacaoId = null;
  salvarRascunho();

  return { carregados: itensDaCotacao.size, ausentes };
}

export function montarCotacoes(alvo) {
  const rascunho = lerRascunho();
  if (rascunho) {
    // Restaura o CLIENTE mesmo sem itens. Antes isto ficava dentro do
    // `if (itens.length)`, então esvaziar a cotação e trocar de aba fazia
    // o cliente escolhido desaparecer — junto com o painel de reposição,
    // que é justamente o que ajuda a remontar o pedido.
    if (clienteId === null && rascunho.clienteId) clienteId = rascunho.clienteId;
    if (!observacoes && rascunho.observacoes) observacoes = rascunho.observacoes;
    if (cotacaoId === null && rascunho.cotacaoId) cotacaoId = rascunho.cotacaoId;

    if (rascunho.itens?.length && itensDaCotacao.size === 0) {
      itensDaCotacao = new Map(rascunho.itens);
    }
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
      ${blocoReposicao()}
      ${blocoBusca()}
      ${blocoLinhas(linhas, totais)}
      ${linhas.length ? blocoDadosPedido() : ''}
    </div>`;

  ligarEventos(alvo);
}

/**
 * Seletor de cliente com busca.
 *
 * Um <select> com 328 opções é inutilizável: rolar até "Refrigeração Icaraí"
 * leva mais tempo que digitar "icarai". Aqui é campo de busca com resultados,
 * casando nome, código, CNPJ, bairro e cidade.
 */
function blocoCliente(cliente) {
  if (cliente) {
    return `<div class="cartao" style="margin-bottom:12px">
      <div class="cartao__corpo" style="padding:12px 16px">
        <div class="entre" style="align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div class="forte">${esc(cliente.nome)}</div>
            <div class="minusculo suave" style="margin-top:2px">
              ${esc(cliente.codigo)}
              ${cliente.cnpj ? ` · CNPJ ${esc(formatarCNPJ(cliente.cnpj))}` : ''}
              ${cliente.contato ? ` · ${esc(cliente.contato)}` : ''}
            </div>
            <div class="minusculo suave">
              ${esc([cliente.logradouro, cliente.bairro, cliente.cidade, cliente.uf]
                .filter(Boolean).join(', '))}
              ${cliente.cep ? ` · CEP ${esc(cliente.cep)}` : ''}
              ${cliente.telefone ? ` · ${esc(cliente.telefone)}` : ''}
            </div>
            ${!cliente.cnpj ? `<div class="minusculo" style="margin-top:4px;color:var(--cor-atencao)">
              ⚠️ Sem CNPJ — o campo sai em branco no pedido.
              <button class="btn btn--pequeno" id="cot-add-cnpj"
                      style="margin-left:6px">Preencher</button>
            </div>` : ''}
          </div>
          <button class="btn btn--pequeno" id="cot-trocar-cliente">Trocar</button>
        </div>
      </div>
    </div>`;
  }

  return `<div class="cartao" style="margin-bottom:12px">
    <div class="cartao__corpo" style="padding:12px 16px">
      <div class="entre" style="gap:10px;align-items:flex-end">
        <div style="flex:1">
          <label class="rotulo" for="cot-cliente-busca">Cliente</label>
          <div class="campo-busca">
            <input class="campo" id="cot-cliente-busca" type="search" autocomplete="off"
                   placeholder="Nome, código, CNPJ, bairro ou cidade…"
                   aria-label="Buscar cliente">
          </div>
        </div>
        <button class="btn" id="cot-novo-cliente">+ Novo cliente</button>
      </div>
      <div id="cot-cliente-resultados" style="margin-top:8px"></div>
    </div>
  </div>`;
}

/**
 * Sugestão de reposição: itens que o cliente costuma comprar e já passaram
 * do próprio ritmo. É a previsão de compra na prática — em vez de esperar o
 * cliente lembrar, o portal chega com a lista pronta.
 */
function blocoReposicao() {
  if (!clienteId) return '';
  const sugestoes = itensParaRepor(clienteId, 6)
    .filter(({ item }) => !itensDaCotacao.has(item.codigo_sigma));
  if (!sugestoes.length) return '';

  return `<div class="cartao" style="margin-bottom:12px">
    <div class="cartao__cabecalho">
      <h2 style="flex:1">🔁 Provável reposição</h2>
      <span class="pequeno suave">${sugestoes.length} item(ns)</span>
    </div>
    <div class="cartao__corpo" style="padding:10px 16px">
      <p class="minusculo suave" style="margin:0 0 8px">
        Itens que este cliente costuma comprar e já passaram do intervalo habitual.
      </p>
      <div class="linha" style="flex-wrap:wrap;gap:6px">
        ${sugestoes.map(({ item, historico }) => `
          <button class="btn btn--pequeno" data-repor="${esc(item.codigo_sigma)}"
                  title="${esc(item.descricao)}">
            + ${esc(item.codigo_sigma)}
            <span class="suave">(${formatarNumero(historico.quantidadeTipica)} un ·
            ${historico.diasDeAtraso}d além)</span>
          </button>`).join('')}
      </div>
    </div>
  </div>`;
}

/** Ordem de folheio da carteira: quem compra hoje aparece primeiro. */
const ORDEM_CARTEIRA = { ativo: 2, recuperacao: 1, inativo: 0 };

function desenharClientes(termo) {
  const caixa = document.getElementById('cot-cliente-resultados');
  if (!caixa) return;

  if (!indiceClientes || indiceClientes.length !== estado.clientes.length) {
    indiceClientes = criarIndice(estado.clientes, (c) =>
      [c.nome, c.codigo, digitosCNPJ(c.cnpj), c.bairro, c.cidade, c.contato]);
  }

  // Campo vazio lista a carteira em vez de pedir que se digite: os ATIVOS
  // primeiro, porque são quem se visita. Antes aparecia só a contagem, e era
  // preciso lembrar o nome do cliente para chegar até ele.
  const folheando = !termo.trim();
  const achados = folheando
    ? [...estado.clientes].sort((a, b) =>
        (ORDEM_CARTEIRA[b.origem] ?? 0) - (ORDEM_CARTEIRA[a.origem] ?? 0)
        || String(a.nome).localeCompare(String(b.nome), 'pt-BR')).slice(0, 60)
    : buscar(indiceClientes, termo, 12);

  if (!achados.length) {
    caixa.innerHTML = `<p class="pequeno suave" style="margin:8px 0 0">
      ${folheando ? 'Carteira vazia.'
                  : 'Nenhum cliente encontrado. Use "+ Novo cliente" para cadastrar.'}</p>`;
    return;
  }

  caixa.innerHTML = `
    ${folheando ? `<p class="minusculo suave" style="margin:6px 0 4px">
      Mostrando ${achados.length} de ${estado.clientes.length} clientes —
      role a lista ou digite para filtrar.</p>` : ''}
    <div style="max-height:300px;overflow-y:auto;
      border:1px solid var(--cor-borda);border-radius:var(--raio)">
    <table class="tabela"><tbody>
      ${achados.map((c) => `<tr data-cliente="${esc(c.id)}" style="cursor:pointer">
        <td>
          <div class="forte">${esc(c.nome)}</div>
          <div class="minusculo suave">
            ${esc(c.codigo)}
            ${c.cnpj ? ` · ${esc(formatarCNPJ(c.cnpj))}` : ' · sem CNPJ'}
          </div>
        </td>
        <td class="pequeno" style="width:170px">
          ${esc(c.bairro || '')}<div class="minusculo suave">${esc(c.cidade || '')}</div>
        </td>
        <td style="width:120px">${seloStatus(c.status)}</td>
      </tr>`).join('')}
    </tbody></table>
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
    const hist = historicoDoItem(clienteId, item.codigo_sigma);
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
          ${item.st ? '<span class="selo selo--info" title="Sujeito a apuração — consultar SIBB">ST</span>' : ''}
          ${excede ? `<span class="selo selo--risco">⚠️ pediu ${formatarNumero(calculo.qtd)}, há ${formatarNumero(item.saldo)}</span>` : ''}
          ${seloHistorico(hist)}
        </div>
        ${hist ? `<div class="minusculo suave" style="margin-top:3px">
          Já comprou ${hist.vezes}× · costuma levar <strong>${formatarNumero(hist.quantidadeTipica)}</strong>
          · última em ${formatarData(hist.ultimaData)} por ${formatarBRL(hist.ultimoValorUnitario)}
          ${hist.quantidadeTipica !== calculo.qtd
            ? `<button class="btn btn--pequeno" data-usar-tipica="${esc(item.codigo_sigma)}"
                       style="margin-left:6px">usar ${formatarNumero(hist.quantidadeTipica)}</button>`
            : ''}
        </div>` : ''}
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
            <button class="btn" id="cot-salvar">💾 Salvar cotação</button>
            <button class="btn btn--primario" id="cot-imprimir">🖨️ PDF do cliente</button>
          </div>
          <p class="minusculo suave" style="margin:8px 0 0;text-align:right">
            Gerar o PDF já salva no histórico. O PDF não contém saldo,
            comissão nem categoria.
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
  const numero = pedido.numeroAtual(estado.cotacoes);
  const validade = validadeCotacao(p.validadeDiasUteis ?? 7);

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
          <input class="campo" id="ped-numero" value="${esc(numero)}"
                 ${p.numeroAutomatico ? 'readonly' : ''}
                 placeholder="Ex.: 2026-0001">
          <label class="linha minusculo suave" style="gap:5px;margin-top:5px;cursor:pointer">
            <input type="checkbox" id="ped-auto" ${p.numeroAutomatico ? 'checked' : ''}>
            Numerar automaticamente
          </label>
          ${p.numeroAutomatico ? `<p class="minusculo suave" style="margin:2px 0 0">
            Calculado do histórico: ${estado.cotacoes.length} cotação(ões) registrada(s).
          </p>` : ''}
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
          <label class="rotulo">Validade da cotação</label>
          <div class="campo" style="display:flex;align-items:center;
               background:var(--cor-superficie-2);cursor:default">
            ${esc(validade.texto)}
          </div>
          <p class="minusculo suave" style="margin:4px 0 0">
            Fixo em 7 dias úteis — pula fim de semana e feriado nacional.
          </p>
        </div>
        <div>
          <label class="rotulo">Frete</label>
          <div class="linha" style="gap:6px">
            ${['CIF', 'FOB'].map((tipo) => `
              <button class="btn ${p.frete === tipo ? 'btn--primario' : ''}"
                      data-frete="${tipo}" style="flex:1">${tipo}</button>`).join('')}
          </div>
          <p class="minusculo suave" style="margin:4px 0 0">
            CIF: frete por conta do remetente · FOB: por conta do destinatário
          </p>
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
  const atual = pedido.ler();
  pedido.gravar({
    ...atual,
    numero: valor('ped-numero') || atual.numero,
    numeroAutomatico: document.getElementById('ped-auto')?.checked ?? true,
    condicoesPagamento: valor('ped-pagamento'),
    prazoEntrega: valor('ped-prazo'),
    // frete e validade não vêm de <input>: um é botão, o outro é calculado.
  });
}

// ---------------------------------------------------------- resultados

function desenharResultados(folheando = false) {
  const caixa = document.getElementById('cot-resultados');
  if (!caixa) return;

  if (!resultadosBusca.length) {
    caixa.innerHTML = `<p class="pequeno suave" style="margin:8px 0 0">${
      folheando ? 'Catálogo vazio.' : 'Nenhum item encontrado.'}</p>`;
    return;
  }

  const total = soComEstoque
    ? estado.catalogo.filter((i) => i.status_estoque !== 'sem_estoque').length
    : estado.catalogo.length;

  caixa.innerHTML = `
    ${folheando ? `<p class="minusculo suave" style="margin:8px 0 4px">
      Mostrando ${resultadosBusca.length} de ${formatarNumero(total)} itens —
      role a lista ou digite para filtrar.</p>` : ''}
    <div class="rolagem" style="max-height:340px;overflow-y:auto;
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
              ${seloHistorico(historicoDoItem(clienteId, item.codigo_sigma))}
            </div>
          </td>
          <td class="valor forte" style="width:110px">${formatarBRL(item.valor_unitario_centavos)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

/**
 * Quantos itens a lista mostra quando NÃO há termo digitado.
 *
 * Antes o campo vazio devolvia lista vazia: era preciso saber o que procurar
 * antes de poder olhar. Numa visita, o representante frequentemente quer
 * FOLHEAR — "o que vocês têm de guarnição?" — e não buscar um código que já
 * conhece. Mostrar o catálogo ao focar transforma a busca também em vitrine.
 *
 * 80 e não o catálogo inteiro: 521 linhas de uma vez travam a rolagem no
 * celular e não ajudam ninguém. Quem precisa de mais digita.
 */
const LISTA_SEM_TERMO = 80;

function rodarBusca(termo) {
  let base = indice;
  if (soComEstoque) {
    base = indice.filter((i) => i.registro.status_estoque !== 'sem_estoque');
  }
  resultadosBusca = buscar(base, termo, termo.trim() ? 40 : LISTA_SEM_TERMO);
  selecionado = 0;
  desenharResultados(!termo.trim());
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
    // Focar já abre a lista: dá para folhear o catálogo sem saber o que
    // procurar. Sem atraso aqui — atraso em resposta a um clique parece travamento.
    busca.addEventListener('focus', () => rodarBusca(busca.value));
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

  // ---- seletor de cliente com busca
  const buscaCliente = alvo.querySelector('#cot-cliente-busca');
  if (buscaCliente) {
    const rodar = comAtraso((v) => desenharClientes(v), 120);
    buscaCliente.addEventListener('input', (e) => rodar(e.target.value));
    buscaCliente.addEventListener('focus', () => desenharClientes(buscaCliente.value));
    desenharClientes(buscaCliente.value);
  }

  alvo.querySelector('#cot-cliente-resultados')?.addEventListener('click', (e) => {
    const linha = e.target.closest('[data-cliente]');
    if (!linha) return;
    clienteId = linha.dataset.cliente;
    salvarRascunho();
    redesenhar(alvo);
  });

  alvo.querySelector('#cot-trocar-cliente')?.addEventListener('click', () => {
    clienteId = null;
    salvarRascunho();
    redesenhar(alvo);
    document.getElementById('cot-cliente-busca')?.focus();
  });

  alvo.querySelector('#cot-novo-cliente')?.addEventListener('click', () => {
    abrirFormularioCliente(null, (novo) => {
      clienteId = novo.id;          // já entra selecionado na cotação
      salvarRascunho();
      redesenhar(alvo);
    });
  });

  alvo.querySelector('#cot-add-cnpj')?.addEventListener('click', () => {
    const c = estado.clientes.find((x) => x.id === clienteId);
    if (c) abrirFormularioCliente(c, () => redesenhar(alvo));
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

  alvo.querySelectorAll('[data-repor]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const codigo = botao.dataset.repor;
      const h = historicoDoItem(clienteId, codigo);
      itensDaCotacao.set(codigo, h?.quantidadeTipica || 1);
      salvarRascunho();
      redesenhar(alvo);
    });
  });

  alvo.querySelectorAll('[data-usar-tipica]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const codigo = botao.dataset.usarTipica;
      const h = historicoDoItem(clienteId, codigo);
      if (!h) return;
      itensDaCotacao.set(codigo, h.quantidadeTipica);
      salvarRascunho();
      redesenhar(alvo);
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

  // `imprimir` é assíncrona: sem o catch, uma falha ao gravar o histórico
  // viraria "unhandled rejection" e o representante não veria nada acontecer.
  alvo.querySelector('#cot-imprimir')?.addEventListener('click', () => {
    imprimir(alvo).catch((erro) => {
      console.error('Falha ao gerar o pedido:', erro);
      avisar(`Não consegui gerar o PDF: ${erro.message}`, 'risco');
    });
  });

  alvo.querySelector('#cot-salvar')?.addEventListener('click', () => {
    salvar().catch((erro) => {
      console.error('Falha ao salvar a cotação:', erro);
      avisar(`Não consegui salvar: ${erro.message}`, 'risco');
    });
  });
  alvo.querySelector('#cot-empresa')?.addEventListener('click', abrirDadosEmpresa);

  // Grava a cada digitação: o representante não deveria ter de "salvar" isto.
  ['ped-numero', 'ped-pagamento', 'ped-prazo']
    .forEach((id) => alvo.querySelector(`#${id}`)
      ?.addEventListener('input', guardarCampoPedido));

  alvo.querySelector('#ped-auto')?.addEventListener('change', () => {
    guardarCampoPedido();
    redesenhar(alvo);            // alterna entre campo editável e automático
  });

  alvo.querySelectorAll('[data-frete]').forEach((botao) =>
    botao.addEventListener('click', () => {
      pedido.gravar({ ...pedido.ler(), frete: botao.dataset.frete });
      redesenhar(alvo);
    }));
}

// --------------------------------------------------------- impressão

/**
 * A folha do pedido, pendurada no `<body>` — nunca dentro da aba.
 *
 * 🔴 Ela morava dentro do HTML da tela de cotações. Qualquer redesenho a
 *    recriava vazia, e redesenho acontece sozinho: `salvarCotacao` avisa os
 *    ouvintes ao gravar, e `sincronizarFila()` avisa de novo quando a rede
 *    responde, centenas de milissegundos depois. Medido: 31.941 caracteres no
 *    instante do `print()`, 0 logo em seguida. No Chrome saía certo por
 *    acidente — `print()` bloqueia a thread e a folha já tinha ido para o
 *    spooler —, mas um Ctrl+P do usuário logo depois imprimia página em branco.
 *
 *    Reordenar o código não resolvia: só tirava a corrida de lugar. Fora do
 *    container redesenhado, o problema deixa de existir por construção.
 */
/**
 * Junta tudo que o documento precisa: o que está na tela AGORA.
 *
 * Uma função só para as duas saídas — salvar e imprimir — porque cotação
 * salva e cotação impressa têm de ser o mesmo documento. Montar cada uma no
 * seu lugar deixaria as duas divergirem em silêncio na primeira alteração.
 */
function montarDocumento() {
  const linhas = montarLinhas();
  const totais = calcularTotais(linhas);
  const cliente = estado.clientes.find((c) => c.id === clienteId) ?? null;
  const dadosPedido = { ...pedido.ler(), numero: pedido.numeroAtual(estado.cotacoes) };
  const validade = validadeCotacao(dadosPedido.validadeDiasUteis ?? 7);

  return {
    linhas,
    totais,
    cliente,
    cotacao: {
      data: hojeISO(),
      vendedor: perfil()?.nome ?? '',
      observacoes,
      validade: validade.texto,
      validadeAte: validade.iso,
      empresa: empresa.ler(),
      pedido: dadosPedido,
      cliente,
      linhas,
      totais,
    },
  };
}

/**
 * O registro que vai para o banco.
 *
 * Guarda a FOTOGRAFIA do documento inteiro — itens, cliente e representação —
 * e não referências. O preço muda toda semana, o cadastro do cliente é
 * corrigido, a I.E. da representação é preenchida depois. Um PDF regerado a
 * partir de referências sairia diferente do que o cliente tem na mão.
 */
function montarRegistro({ linhas, totais, cliente, cotacao }, situacao) {
  const p = cotacao.pedido;

  // O id nasce no primeiro salvamento e não muda mais. É o que faz "salvar" e
  // depois "gerar PDF" atualizarem o MESMO registro em vez de criar dois.
  cotacaoId ??= `cot_${hojeISO().replace(/-/g, '')}_${cliente.codigo}`
              + `_${Date.now().toString(36)}`;
  salvarRascunho();

  return {
    id: cotacaoId,
    equipe_id: perfil()?.equipe_id,
    representante_id: perfil()?.id,
    cliente_id: cliente.id,
    nome_cliente: cliente.nome,
    vendedor: cotacao.vendedor || null,
    numero: p.numero || null,
    data: cotacao.data,
    situacao,
    total_produtos_centavos: totais.totalProdutos,
    total_ipi_centavos: totais.totalIpi,
    total_com_ipi_centavos: totais.totalComIpi,
    quantidade_itens: totais.quantidadeItens,

    // `codigo_fabricante` e `st` entram aqui porque o PDF os imprime. Sem
    // eles, o documento regerado sairia com colunas vazias.
    itens: linhas.map(({ item, calculo }) => ({
      codigo_sigma: item.codigo_sigma,
      codigo_fabricante: item.codigo_fabricante ?? null,
      descricao: item.descricao,
      st: !!item.st,
      quantidade: calculo.qtd,
      valor_unitario_centavos: item.valor_unitario_centavos,
      ipi: item.ipi,
      valor_produtos_centavos: calculo.valorProdutos,
      valor_com_ipi_centavos: calculo.valorComIpi,
    })),

    // 🔒 Só o que o PDF imprime. Saldo, origem e situação comercial são dados
    //    internos e não entram nem no papel nem nesta fotografia.
    cliente: {
      nome: cliente.nome,
      codigo: cliente.codigo,
      cnpj: cliente.cnpj ?? null,
      inscricao_estadual: cliente.inscricao_estadual ?? null,
      logradouro: cliente.logradouro ?? null,
      bairro: cliente.bairro ?? null,
      cidade: cliente.cidade ?? null,
      uf: cliente.uf ?? null,
      cep: cliente.cep ?? null,
      contato: cliente.contato ?? null,
      telefone: cliente.telefone ?? null,
      email: cliente.email ?? null,
    },
    empresa: cotacao.empresa,

    observacoes: cotacao.observacoes || null,
    condicoes: {
      pagamento: p.condicoesPagamento || null,
      prazo: p.prazoEntrega || null,
      validade: cotacao.validade,
      // A DATA, além do texto. O histórico marca a cotação como expirada
      // comparando com hoje, e extrair data de "7 dias úteis — até 12/08/2026"
      // por expressão regular quebraria no dia em que o texto mudasse.
      validadeAte: cotacao.validadeAte,
      frete: p.frete || null,
    },
  };
}

/** Salvar sem imprimir: arquiva a cotação e segue a vida. */
async function salvar() {
  const documento = montarDocumento();
  if (!documento.linhas.length) {
    avisar('A cotação está vazia.', 'atencao');
    return;
  }
  if (!documento.cliente) {
    avisar('Escolha o cliente antes de salvar — o histórico é por cliente.', 'atencao');
    return;
  }
  if (!recursos.cotacoes) {
    avisar('Histórico indisponível: rode a migração 03 no Supabase.', 'risco');
    return;
  }

  guardarCampoPedido();

  // 'rascunho', não 'enviada': salvar é guardar o trabalho, não mandar ao
  // cliente. Quem manda é o PDF, e é ele que promove a situação.
  const registro = montarRegistro(documento, 'rascunho');
  await salvarCotacao(registro);
  avisar(`Cotação ${registro.numero || ''} salva como rascunho.`, 'ok');
}

async function imprimir(alvo) {
  const documento = montarDocumento();
  if (!documento.linhas.length) { avisar('A cotação está vazia.', 'atencao'); return; }

  const { totais, cliente, cotacao } = documento;
  if (totais.itensSemEstoque &&
      !confirmar(`Esta cotação tem ${totais.itensSemEstoque} item(ns) SEM ESTOQUE.\n\nGerar o PDF assim mesmo?`)) {
    return;
  }

  guardarCampoPedido();

  // 🔒 Sanitiza ANTES de gerar o HTML: o dado interno nunca entra na página.
  await imprimirHTML(gerarPedidoHTML(sanitizarParaCliente(cotacao)));

  // Só avança a numeração depois de o pedido ter sido efetivamente gerado.
  pedido.avancarNumero();
  const campoNumero = document.getElementById('ped-numero');
  if (campoNumero) campoNumero.value = pedido.ler().numero;

  // Arquiva DEPOIS de imprimir: gerar o PDF é o que o representante veio
  // fazer, e uma falha ao arquivar não pode impedir isso.
  if (cliente) await salvarCotacao(montarRegistro(documento, 'enviada'));
}

// Atalho global: "/" foca a busca de qualquer lugar da tela de cotações.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
  const dentroDeCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (dentroDeCampo) return;
  const busca = document.getElementById('cot-busca');
  if (busca) { e.preventDefault(); busca.focus(); busca.select(); }
});
