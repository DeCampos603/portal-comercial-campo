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

import { formatarBRL, formatarPercentual, formatarData } from '../nucleo/moeda.js';
import { esc } from '../nucleo/ui.js';
import { formatarCNPJ } from '../carteira/formulario.js';
import { LOGO_SIBB, LOGO_MAJOAQUIM } from './logos.js';

/** Valor preenchido, ou uma linha para completar à caneta. */
const ou = (valor, largura = '120px') => (String(valor ?? '').trim()
  ? esc(valor)
  : `<span style="display:inline-block;min-width:${largura};border-bottom:1px solid #999">&nbsp;</span>`);

export function gerarPedidoHTML(cotacao) {
  const { cliente, linhas, totais } = cotacao;
  const emp = cotacao.empresa ?? {};
  const ped = cotacao.pedido ?? {};

  const itens = linhas.map(({ item, calculo }, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(item.codigo_fabricante || '')}</td>
      <td>${esc(item.codigo_sigma)}</td>
      <td>${esc(item.descricao)}${item.st ? ' <strong>(ST)</strong>' : ''}</td>
      <td style="text-align:right">${calculo.qtd}</td>
      <td style="text-align:right">${formatarPercentual(item.ipi)}</td>
      <td style="text-align:right">${formatarBRL(item.valor_unitario_centavos)}</td>
      <td style="text-align:right">${formatarBRL(calculo.valorProdutos)}</td>
      <td style="text-align:right">${formatarBRL(calculo.valorComIpi)}</td>
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
      <div style="text-align:right;font-size:9pt">
        ${LOGO_SIBB ? `<img src="${LOGO_SIBB}" alt=""
             style="height:30px;margin-bottom:6px;display:inline-block">` : ''}
        <div><strong>Pedido nº</strong> ${ou(ped.numero, '90px')}</div>
        <div><strong>Data:</strong> ${formatarData(cotacao.data)}</div>
        <div><strong>Vendedor:</strong> ${esc(cotacao.vendedor || '')}</div>
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
          <th>Item</th><th>Código</th><th>Cód. Sigma</th><th>Compatibilidade / Descrição</th>
          <th style="text-align:right">Qtd.</th><th style="text-align:right">IPI</th>
          <th style="text-align:right">Vlr. Unit.</th>
          <th style="text-align:right">Vlr. Produtos</th>
          <th style="text-align:right">Vlr. c/ IPI</th>
        </tr>
      </thead>
      <tbody>${itens}</tbody>
    </table>

    <div class="bloco-total">
      <table>
        <tr>
          <td>Valor Total dos Produtos</td>
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

    <div style="margin-top:16px;font-size:9pt;line-height:1.9">
      <div><strong>Condições de pagamento:</strong> ${ou(ped.condicoesPagamento, '220px')}</div>
      <div><strong>Prazo de entrega:</strong> ${ou(ped.prazoEntrega, '180px')}</div>
      <div><strong>Validade da cotação:</strong> ${ou(cotacao.validade, '200px')}</div>
      ${ped.frete?.trim() ? `<div><strong>Frete:</strong> ${esc(ped.frete)}</div>` : ''}
    </div>

    ${cotacao.observacoes ? `
    <div style="margin-top:12px;font-size:9pt">
      <strong>OBSERVAÇÕES</strong>
      <div style="white-space:pre-wrap;border:1px solid #999;padding:6px;margin-top:4px;min-height:40px">${esc(cotacao.observacoes)}</div>
    </div>` : ''}

    ${temST ? `
    <p style="margin-top:10px;font-size:8pt;font-style:italic">
      Itens assinalados com (ST) estão sujeitos a apuração de Substituição Tributária —
      consultar a Sigma.
    </p>` : ''}

    <div class="assinaturas">
      <div>Responsável pela Aprovação — Representante</div>
      <div>Autorização Sigma</div>
    </div>
  </div>`;
}
