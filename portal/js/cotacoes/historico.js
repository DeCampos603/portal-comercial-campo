/**
 * Histórico de cotações — o que já foi cotado, e o PDF de volta.
 *
 * A regra que organiza este arquivo inteiro:
 *
 *   🔒 GERAR PDF sai da FOTOGRAFIA. REABRIR sai do CATÁLOGO DE HOJE.
 *
 * São coisas diferentes e é fácil confundir. O PDF regerado tem de ser o
 * documento que o cliente recebeu — preço, endereço e condições daquele dia,
 * ainda que a tabela tenha mudado três vezes desde então. Já reabrir serve
 * para emitir um pedido NOVO a partir de um antigo, e aí o preço certo é o
 * de hoje. Misturar os dois ou entrega um PDF que não bate com o do cliente,
 * ou refaz um pedido com preço vencido.
 */

import { estado, aoMudar, salvarCotacao, excluirCotacao, recursos } from '../nucleo/dados.js';
import { esc, vazio, avisar, confirmar, abrirPainel } from '../nucleo/ui.js';
import { formatarBRL, formatarData, formatarPercentual } from '../nucleo/moeda.js';
import { criarIndice, buscar } from '../nucleo/busca.js';
import { gerarPedidoHTML } from './exportar.js';
import { imprimirHTML } from './impressao.js';
import { carregarNaCotacao } from './tela.js';

const SITUACOES = {
  rascunho: ['Rascunho', ''],
  enviada: ['Enviada', 'info'],
  aprovada: ['Aprovada', 'ok'],
  recusada: ['Recusada', 'risco'],
  expirada: ['Expirada', 'atencao'],
};

const filtros = { texto: '', situacao: new Set(), periodo: 'todos' };
let indice = null;

// ---------------------------------------------------------------- api

export function montarHistorico(alvo) {
  const soltar = aoMudar(() => desenhar(alvo));
  desenhar(alvo);
  return soltar;
}

// ----------------------------------------------------------- filtragem

function dentroDoPeriodo(cotacao) {
  if (filtros.periodo === 'todos') return true;
  const dias = { '30': 30, '90': 90, '365': 365 }[filtros.periodo];
  if (!dias) return true;
  const limite = new Date();
  limite.setDate(limite.getDate() - dias);
  return String(cotacao.data) >= limite.toISOString().slice(0, 10);
}

function cotacoesFiltradas() {
  let lista = estado.cotacoes;

  if (filtros.texto.trim()) {
    if (!indice || indice.length !== estado.cotacoes.length) {
      // O campo 0 é tratado como "código" pelo índice e pesa mais na
      // relevância — aqui o código é o NÚMERO do pedido.
      indice = criarIndice(estado.cotacoes, (c) => [
        c.numero, c.nome_cliente, c.vendedor,
        // Busca também pelo código do item: "quem cotou a SGU-1828A?" é uma
        // pergunta que o representante faz de verdade.
        ...(c.itens ?? []).map((i) => i.codigo_sigma),
      ]);
    }
    // Limite alto: o histórico só cresce, e cortar em 50 esconderia cotação
    // antiga justamente de quem foi procurar por ela.
    lista = buscar(indice, filtros.texto, 1000);
  }

  if (filtros.situacao.size) {
    lista = lista.filter((c) => filtros.situacao.has(c.situacao));
  }
  lista = lista.filter(dentroDoPeriodo);

  return [...lista].sort((a, b) =>
    String(b.data).localeCompare(String(a.data))
    || String(b.criado_em ?? '').localeCompare(String(a.criado_em ?? '')));
}

// -------------------------------------------------------------- pintura

function selo(situacao) {
  const [rotulo, classe] = SITUACOES[situacao] ?? [situacao || '—', ''];
  return `<span class="selo ${classe ? `selo--${classe}` : ''}">${esc(rotulo)}</span>`;
}

function desenhar(alvo) {
  if (!recursos.cotacoes) {
    alvo.innerHTML = `<div class="cartao">${vazio('🗄️', 'Histórico indisponível',
      'A tabela de cotações ainda não existe no banco. '
      + 'Rode modelos/supabase/03-cnpj-e-cotacoes.sql no Supabase.')}</div>`;
    return;
  }

  const lista = cotacoesFiltradas();
  const total = lista.reduce((s, c) => s + (c.total_com_ipi_centavos ?? 0), 0);

  alvo.innerHTML = `
    <div class="grade" style="gap:12px">
      ${recursos.fotografiaCotacao ? '' : `<div class="faixa faixa--atencao">
        ⚠️ Migração 05 não aplicada. O histórico funciona, mas o PDF regerado
        usa o cadastro ATUAL do cliente, não o do dia da cotação.
      </div>`}

      <div class="cartao">
        <div class="cartao__corpo grade" style="gap:10px">
          <input class="campo" id="hist-busca" type="search"
                 placeholder="Cliente, número do pedido ou código do item…"
                 value="${esc(filtros.texto)}">
          <div class="linha" style="gap:12px;flex-wrap:wrap">
            ${Object.entries(SITUACOES).map(([v, [rotulo]]) => `
              <label class="linha pequeno" style="gap:5px;cursor:pointer">
                <input type="checkbox" data-situacao="${v}"
                  ${filtros.situacao.has(v) ? 'checked' : ''}> ${rotulo}
              </label>`).join('')}
            <span style="width:1px;height:18px;background:var(--cor-borda)"></span>
            <select class="campo" id="hist-periodo" style="width:auto;min-height:30px">
              ${[['todos', 'Todo o período'], ['30', 'Últimos 30 dias'],
                 ['90', 'Últimos 90 dias'], ['365', 'Último ano']]
                .map(([v, r]) => `<option value="${v}"
                  ${filtros.periodo === v ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="linha pequeno suave" style="justify-content:space-between">
        <span>${lista.length} cotação(ões)</span>
        <span class="forte">${formatarBRL(total)} somados</span>
      </div>

      ${lista.length ? `
      <div class="cartao"><div class="rolagem">
        <table class="tabela">
          <thead><tr>
            <th>Data</th><th>Nº</th><th>Cliente</th>
            <th style="text-align:right">Itens</th>
            <th style="text-align:right">Total c/ IPI</th>
            <th>Situação</th><th></th>
          </tr></thead>
          <tbody>${lista.map(linha).join('')}</tbody>
        </table>
      </div></div>` : `<div class="cartao">${vazio('🗂️',
        estado.cotacoes.length ? 'Nenhuma cotação neste filtro'
                               : 'Nenhuma cotação salva ainda',
        estado.cotacoes.length ? 'Afrouxe os filtros acima.'
          : 'Monte uma cotação e use "Salvar cotação" ou "PDF do cliente".')}</div>`}
    </div>`;

  ligar(alvo);
}

function linha(c) {
  return `<tr data-abrir="${esc(c.id)}" style="cursor:pointer">
    <td class="pequeno">${formatarData(c.data)}</td>
    <td class="pequeno forte">${esc(c.numero || '—')}</td>
    <td>
      <div class="forte">${esc(c.nome_cliente || '—')}</div>
      ${c.vendedor ? `<div class="minusculo suave">${esc(c.vendedor)}</div>` : ''}
    </td>
    <td style="text-align:right">${c.quantidade_itens ?? 0}</td>
    <td style="text-align:right" class="forte">${formatarBRL(c.total_com_ipi_centavos)}</td>
    <td>${selo(c.situacao)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn--pequeno" data-pdf="${esc(c.id)}"
              title="Gerar o PDF como foi enviado">🖨️</button>
    </td>
  </tr>`;
}

function ligar(alvo) {
  const busca = alvo.querySelector('#hist-busca');
  busca?.addEventListener('input', (e) => {
    filtros.texto = e.target.value;
    desenhar(alvo);
    const campo = alvo.querySelector('#hist-busca');
    campo.focus();
    campo.setSelectionRange(campo.value.length, campo.value.length);
  });

  alvo.querySelectorAll('[data-situacao]').forEach((cb) =>
    cb.addEventListener('change', () => {
      if (cb.checked) filtros.situacao.add(cb.dataset.situacao);
      else filtros.situacao.delete(cb.dataset.situacao);
      desenhar(alvo);
    }));

  alvo.querySelector('#hist-periodo')?.addEventListener('change', (e) => {
    filtros.periodo = e.target.value;
    desenhar(alvo);
  });

  // O botão do PDF fica DENTRO da linha clicável: sem o stopPropagation,
  // um clique nele imprimiria e abriria a ficha ao mesmo tempo.
  alvo.querySelectorAll('[data-pdf]').forEach((botao) =>
    botao.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = estado.cotacoes.find((x) => x.id === botao.dataset.pdf);
      if (c) gerarPDF(c);
    }));

  alvo.querySelectorAll('[data-abrir]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const c = estado.cotacoes.find((x) => x.id === tr.dataset.abrir);
      if (c) abrirFicha(c);
    }));
}

// --------------------------------------------------------------- ficha

function abrirFicha(c) {
  const itens = c.itens ?? [];
  const cond = c.condicoes ?? {};

  abrirPainel(`${c.numero || 'Cotação'} — ${c.nome_cliente || ''}`, `
    <div class="grade" style="gap:12px">
      <div class="linha" style="gap:8px;flex-wrap:wrap">
        ${selo(c.situacao)}
        <span class="selo">${formatarData(c.data)}</span>
        ${c.vendedor ? `<span class="selo">${esc(c.vendedor)}</span>` : ''}
      </div>

      <div class="rolagem">
        <table class="tabela">
          <thead><tr>
            <th>Código</th><th>Descrição</th>
            <th style="text-align:right">Qtd</th>
            <th style="text-align:right">Unitário</th>
            <th style="text-align:right">IPI</th>
            <th style="text-align:right">c/ IPI</th>
          </tr></thead>
          <tbody>${itens.map((i) => `<tr>
            <td class="pequeno">${esc(i.codigo_sigma)}</td>
            <td class="pequeno">${esc(i.descricao || '')}</td>
            <td style="text-align:right">${i.quantidade}</td>
            <td style="text-align:right">${formatarBRL(i.valor_unitario_centavos)}</td>
            <td style="text-align:right">${formatarPercentual(i.ipi)}</td>
            <td style="text-align:right">${formatarBRL(i.valor_com_ipi_centavos)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>

      <table class="tabela">
        <tr><td class="suave">Produtos</td>
            <td class="valor">${formatarBRL(c.total_produtos_centavos)}</td></tr>
        <tr><td class="suave">IPI</td>
            <td class="valor">${formatarBRL(c.total_ipi_centavos)}</td></tr>
        <tr><td class="forte">Total com IPI</td>
            <td class="valor forte">${formatarBRL(c.total_com_ipi_centavos)}</td></tr>
      </table>

      ${cond.pagamento || cond.prazo || cond.frete || cond.validade ? `
      <div class="pequeno grade" style="gap:2px">
        ${cond.pagamento ? `<div><span class="suave">Pagamento:</span> ${esc(cond.pagamento)}</div>` : ''}
        ${cond.prazo ? `<div><span class="suave">Prazo:</span> ${esc(cond.prazo)}</div>` : ''}
        ${cond.frete ? `<div><span class="suave">Frete:</span> ${esc(cond.frete)}</div>` : ''}
        ${cond.validade ? `<div><span class="suave">Validade:</span> ${esc(cond.validade)}</div>` : ''}
      </div>` : ''}

      ${c.observacoes ? `<div class="pequeno">
        <span class="suave">Observações:</span><br>${esc(c.observacoes)}
      </div>` : ''}

      <div>
        <label class="rotulo" for="hist-situacao">Situação</label>
        <select class="campo" id="hist-situacao">
          ${Object.entries(SITUACOES).map(([v, [rotulo]]) => `
            <option value="${v}" ${c.situacao === v ? 'selected' : ''}>${rotulo}</option>`).join('')}
        </select>
      </div>

      <div class="linha" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn--primario" id="hist-pdf">🖨️ Gerar PDF</button>
        <button class="btn" id="hist-reabrir">↩️ Refazer cotação</button>
        <button class="btn btn--risco" id="hist-excluir">🗑️ Excluir</button>
      </div>
      <p class="minusculo suave" style="margin:0">
        O PDF sai exatamente como foi enviado, com os preços do dia
        ${formatarData(c.data)}. "Refazer" leva os itens para a aba Cotações
        com os preços de <strong>hoje</strong>.
      </p>
    </div>`);

  document.getElementById('hist-pdf').addEventListener('click', () => gerarPDF(c));

  document.getElementById('hist-situacao').addEventListener('change', async (e) => {
    try {
      await salvarCotacao({ ...c, situacao: e.target.value });
      avisar('Situação atualizada.', 'ok');
    } catch (erro) {
      avisar(`Não consegui atualizar: ${erro.message}`, 'risco');
    }
  });

  document.getElementById('hist-reabrir').addEventListener('click', () => {
    const { carregados, ausentes } = carregarNaCotacao(c);
    document.querySelector('.painel')?.remove();
    location.hash = '#/cotacoes';
    if (ausentes.length) {
      avisar(`${carregados} item(ns) carregados. Fora do catálogo atual: `
        + `${ausentes.join(', ')}`, 'atencao');
    } else {
      avisar(`${carregados} item(ns) carregados com os preços de hoje.`, 'ok');
    }
  });

  document.getElementById('hist-excluir').addEventListener('click', async () => {
    if (!confirmar(`Excluir a cotação ${c.numero || ''} de ${c.nome_cliente}?\n\n`
      + 'Isto some com o registro para toda a equipe e não dá para desfazer.')) return;
    try {
      await excluirCotacao(c.id);
      document.querySelector('.painel')?.remove();
      avisar('Cotação excluída.', 'info');
    } catch (erro) {
      avisar(`Não consegui excluir: ${erro.message}`, 'risco');
    }
  });
}

// ------------------------------------------------------------------ pdf

/**
 * Devolve a cotação salva ao formato que `gerarPedidoHTML` espera.
 *
 * 🔒 Tudo sai da fotografia. O único caso em que se olha para o cadastro atual
 *    é quando a fotografia não existe — cotação anterior à migração 05 — e aí
 *    o rodapé do painel já avisa que o documento pode não bater.
 */
function rehidratar(c) {
  const cliente = c.cliente ?? clienteAtualComoUltimoRecurso(c);

  const linhas = (c.itens ?? []).map((i) => ({
    item: {
      codigo_sigma: i.codigo_sigma,
      codigo_fabricante: i.codigo_fabricante ?? '',
      descricao: i.descricao ?? '',
      st: !!i.st,
      ipi: i.ipi ?? 0,
      valor_unitario_centavos: i.valor_unitario_centavos ?? 0,
    },
    calculo: {
      qtd: i.quantidade ?? 0,
      // Cotações antigas não guardavam o valor dos produtos. Derivar é seguro:
      // é multiplicação de dois campos que ESTÃO na fotografia, não uma
      // consulta ao preço de hoje.
      valorProdutos: i.valor_produtos_centavos
        ?? (i.valor_unitario_centavos ?? 0) * (i.quantidade ?? 0),
      valorComIpi: i.valor_com_ipi_centavos ?? 0,
    },
  }));

  const cond = c.condicoes ?? {};
  return {
    data: c.data,
    vendedor: c.vendedor ?? '',
    observacoes: c.observacoes ?? '',
    validade: cond.validade ?? '',
    empresa: c.empresa ?? {},
    pedido: {
      numero: c.numero ?? '',
      condicoesPagamento: cond.pagamento ?? '',
      prazoEntrega: cond.prazo ?? '',
      frete: cond.frete ?? '',
    },
    cliente,
    linhas,
    totais: {
      totalProdutos: c.total_produtos_centavos ?? 0,
      totalIpi: c.total_ipi_centavos ?? 0,
      totalComIpi: c.total_com_ipi_centavos ?? 0,
      quantidadeItens: c.quantidade_itens ?? 0,
    },
  };
}

/** Só para cotação anterior à migração 05, que não tem fotografia. */
function clienteAtualComoUltimoRecurso(c) {
  return estado.clientes.find((x) => x.id === c.cliente_id)
    ?? { nome: c.nome_cliente ?? '' };
}

async function gerarPDF(c) {
  try {
    // Não passa por `sanitizarParaCliente`: a fotografia já nasceu limpa —
    // saldo, comissão e categoria nunca entraram nela. Sanitizar de novo aqui
    // daria a impressão de que o dado interno chega até este ponto.
    await imprimirHTML(gerarPedidoHTML(rehidratar(c)));
  } catch (erro) {
    console.error('Falha ao regerar o PDF:', erro);
    avisar(`Não consegui gerar o PDF: ${erro.message}`, 'risco');
  }
}
