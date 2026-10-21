/**
 * Gera o HTML do pedido no formato da Sigma, para impressão em PDF.
 *
 * 🔒 Recebe a cotação JÁ sanitizada por `sanitizarParaCliente()`. Este módulo
 *    não deve conhecer saldo, comissão nem categoria — se o dado não chega
 *    aqui, nenhum "inspecionar elemento", print ou seleção de texto o revela.
 *
 * Cabeçalho e condições vêm do que o REPRESENTANTE preencheu (dadosPedido.js).
 * Campo não preenchido sai como uma linha em branco para escrever à mão — nunca
 * um valor inventado. Num documento comercial, espaço em branco é honesto;
 * número chutado é problema.
 */

import { formatarBRL, formatarPercentual, formatarData, hojeISO } from '../nucleo/moeda.js';
import { esc } from '../nucleo/ui.js';
import { formatarCNPJ } from '../carteira/formulario.js';
import { LOGO_SIBB, LOGO_MAJOAQUIM } from './logos.js';

/** Valor preenchido, ou uma linha para completar à caneta. */
const ou = (valor, largura = '120px') => (String(valor ?? '').trim()
  ? esc(valor)
  : `<span style="display:inline-block;min-width:${largura};border-bottom:1px solid #999">&nbsp;</span>`);

/**
 * Formata um nome de arquivo inteligente e padronizado para salvar em PDF.
 * Exemplo: `Pedido_0042_FastCar_Oficina_2026-09-11`
 */
export function formatarNomeArquivoPDF(cotacao) {
  const ped = cotacao?.pedido ?? {};
  const numeroBruto = String(ped.numero || '').trim();
  const numero = numeroBruto ? numeroBruto.replace(/[^a-zA-Z0-9_-]/g, '_') : 'SemNumero';
  const clienteNome = String(cotacao?.cliente?.nome || 'Cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  const data = String(cotacao?.data || hojeISO()).replace(/[^0-9-]/g, '');
  return `Pedido_${numero}_${clienteNome || 'Cliente'}_${data}`;
}

export function gerarPedidoHTML(cotacao) {
  const { cliente, linhas, totais } = cotacao;
  const emp = cotacao.empresa ?? {};
  const ped = cotacao.pedido ?? {};

  const temDesconto = linhas.some(({ calculo }) => (calculo.descontoPercentual || 0) > 0);
  const totalPecas = linhas.reduce((acc, { calculo }) => acc + (Number(calculo.qtd) || 0), 0);

  const itens = linhas.map(({ item, calculo }, i) => `
    <tr>
      <td class="col-item">${i + 1}</td>
      <td class="col-cod">${esc(item.codigo_fabricante || '')}</td>
      <td class="col-sigma">${esc(item.codigo_sigma)}</td>
      <td class="col-desc">${esc(item.descricao)}${item.st ? ' <span class="pedido__selo-st">ST</span>' : ''}</td>
      <td class="col-qtd" style="text-align:right">${calculo.qtd}</td>
      <td class="col-ipi" style="text-align:right">${formatarPercentual(item.ipi)}</td>
      <td class="col-unit" style="text-align:right">${formatarBRL(item.valor_unitario_centavos)}</td>
      ${temDesconto ? `<td class="col-desc-pct" style="text-align:right">${calculo.descontoPercentual ? `${calculo.descontoPercentual}%` : '—'}</td>` : ''}
      <td class="col-prod" style="text-align:right">${formatarBRL(calculo.valorProdutos)}</td>
      <td class="col-total" style="text-align:right">${formatarBRL(calculo.valorComIpi)}</td>
    </tr>`).join('');

  const temST = linhas.some(({ item }) => item.st);

  return `
  <div class="pedido">
    <div class="pedido__topo">
      <div>
        ${LOGO_MAJOAQUIM ? `<img src="${LOGO_MAJOAQUIM}" alt=""
             style="height:34px;margin-bottom:6px;display:block">` : ''}
        <h1 class="pedido__titulo">PEDIDO DE COMPRA DE PRODUTOS</h1>
        <div style="font-size:9pt">${esc(emp.razaoSocial || 'M A JOAQUIM REPRESENTAÇÃO')}</div>
        <div style="font-size:8pt">CNPJ ${ou(emp.cnpj, '140px')}
          · I.E. ${ou(emp.inscricaoEstadual, '90px')}</div>
        ${emp.telefone || emp.email ? `<div style="font-size:8pt">
          ${esc(emp.telefone || '')}${emp.telefone && emp.email ? ' · ' : ''}${esc(emp.email || '')}
        </div>` : ''}
      </div>
      <div class="pedido__meta">
        ${LOGO_SIBB ? `<img src="${LOGO_SIBB}" alt=""
             style="height:30px;margin-bottom:6px;display:inline-block">` : ''}
        <div class="pedido__numero-box">
          <span class="pedido__numero-rotulo">Pedido nº</span>
          <span class="pedido__numero-valor">${ou(ped.numero, '90px')}</span>
        </div>
        <div class="pedido__meta-linha"><strong>Data:</strong> ${formatarData(cotacao.data)}</div>
        <div class="pedido__meta-linha"><strong>Vendedor:</strong> ${esc(cotacao.vendedor || '')}</div>
      </div>
    </div>

    <table class="pedido__dados">
      <tr>
        <td class="campo-rotulo">Cliente:</td>
        <td colspan="3">${esc(cliente?.nome || '')}</td>
      </tr>
      <tr>
        <td class="campo-rotulo">CNPJ:</td>
        <td>${ou(formatarCNPJ(cliente?.cnpj), '150px')}</td>
        <td class="campo-rotulo">I.E.:</td>
        <td>${ou(cliente?.inscricao_estadual, '90px')}</td>
      </tr>
      <tr>
        <td class="campo-rotulo">Endereço:</td>
        <td colspan="3">${esc([cliente?.logradouro, cliente?.bairro].filter(Boolean).join(', '))}</td>
      </tr>
      <tr>
        <td class="campo-rotulo">Cidade / UF:</td>
        <td>${esc([cliente?.cidade, cliente?.uf].filter(Boolean).join(' / '))}</td>
        <td class="campo-rotulo">CEP:</td>
        <td>${esc(cliente?.cep || '')}</td>
      </tr>
      <tr>
        <td class="campo-rotulo">Contato:</td>
        <td>${esc(cliente?.contato || '')}</td>
        <td class="campo-rotulo">Fone:</td>
        <td>${esc(cliente?.telefone || '')}</td>
      </tr>
      <tr>
        <td class="campo-rotulo">E-mail:</td>
        <td colspan="3">${esc(cliente?.email || '')}</td>
      </tr>
    </table>

    <table class="tabela">
      <thead>
        <tr>
          <th class="col-item">Item</th>
          <th class="col-cod">Código</th>
          <th class="col-sigma">Cód. Sigma</th>
          <th class="col-desc">Compatibilidade / Descrição</th>
          <th class="col-qtd" style="text-align:right">Qtd.</th>
          <th class="col-ipi" style="text-align:right">IPI</th>
          <th class="col-unit" style="text-align:right">Vlr. Unit.</th>
          ${temDesconto ? '<th class="col-desc-pct" style="text-align:right">Desc.</th>' : ''}
          <th class="col-prod" style="text-align:right">Vlr. Produtos</th>
          <th class="col-total" style="text-align:right">Vlr. c/ IPI</th>
        </tr>
      </thead>
      <tbody>${itens}</tbody>
    </table>

    <div class="bloco-total">
      <div class="bloco-total__resumo">
        <div class="bloco-total__resumo-titulo">Resumo de Volumes</div>
        <div class="bloco-total__resumo-detalhe">
          <span><strong>${totais.quantidadeItens}</strong> item(ns)</span>
          <span class="divisor-ponto">·</span>
          <span><strong>${totalPecas}</strong> peça(s)</span>
        </div>
      </div>

      <table class="bloco-total__tabela">
        ${totais.totalDesconto ? `
        <tr>
          <td>Valor Bruto dos Produtos</td>
          <td style="text-align:right">${formatarBRL(totais.totalBruto)}</td>
        </tr>
        <tr class="linha-desconto">
          <td>Desconto Comercial</td>
          <td style="text-align:right">- ${formatarBRL(totais.totalDesconto)}</td>
        </tr>` : ''}
        <tr>
          <td>Valor Total dos Produtos${totais.totalDesconto ? ' (Líquido)' : ''}</td>
          <td style="text-align:right">${formatarBRL(totais.totalProdutos)}</td>
        </tr>
        <tr>
          <td>IPI</td>
          <td style="text-align:right">${formatarBRL(totais.totalIpi)}</td>
        </tr>
        <tr class="destaque">
          <td>Valor Total com IPI</td>
          <td style="text-align:right">${formatarBRL(totais.totalComIpi)}</td>
        </tr>
      </table>
    </div>

    <div class="pedido__condicoes">
      <div class="pedido__cond-card">
        <div class="pedido__cond-rotulo">Condições de Pagamento</div>
        <div class="pedido__cond-valor">${ou(ped.condicoesPagamento, '160px')}</div>
      </div>
      <div class="pedido__cond-card">
        <div class="pedido__cond-rotulo">Prazo de Entrega</div>
        <div class="pedido__cond-valor">${ou(ped.prazoEntrega, '140px')}</div>
      </div>
      <div class="pedido__cond-card">
        <div class="pedido__cond-rotulo">Validade da Cotação</div>
        <div class="pedido__cond-valor">${ou(cotacao.validade, '140px')}</div>
      </div>
      <div class="pedido__cond-card">
        <div class="pedido__cond-rotulo">Frete</div>
        <div class="pedido__cond-valor">${ou(ped.frete, '140px')}</div>
      </div>
    </div>

    ${cotacao.observacoes ? `
    <div class="pedido__observacoes">
      <div class="pedido__obs-titulo">Observações</div>
      <div class="pedido__obs-corpo">${esc(cotacao.observacoes)}</div>
    </div>` : ''}

    ${temST ? `
    <div class="pedido__aviso-st">
      ℹ️ Itens assinalados com <strong>ST</strong> estão sujeitos a apuração de Substituição Tributária — consultar a Sigma.
    </div>` : ''}

    <div class="assinaturas">
      <div>Responsável pela Aprovação — Representante</div>
      <div>Autorização Sigma</div>
    </div>

    <div class="pedido__rodape-doc">
      Documento comercial emitido via Portal Comercial Sigma · M A JOAQUIM REPRESENTAÇÃO
    </div>
  </div>`;
}
