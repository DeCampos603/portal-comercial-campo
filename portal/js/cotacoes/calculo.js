/**
 * Motor de cálculo da cotação. Funções puras, sem DOM — testáveis sozinhas.
 *
 * ESCOPO (decisão do usuário): calcula-se APENAS o IPI.
 *   - Comissão: não é calculada. A alíquota existe nos dados, mas nenhum valor
 *     é apurado.
 *   - ST: os 11 itens marcados ganham só um selo visual. Inventar um MVA seria
 *     o pior erro possível deste projeto.
 *
 * Dois bugs da planilha original que este módulo NÃO reproduz:
 *   1. `SUM(I20:I538)` deixa os itens 520 e 521 fora do total. Aqui somamos
 *      todas as linhas, sempre.
 *   2. Item sem preço vira `null` e aparece como "—". Nunca R$ 0,00, que
 *      somaria zero e sumiria no total.
 */

import { SALDO_SEM_ESTOQUE, SALDO_BAIXO } from '../config.js';

/** Reproduz o semáforo de estoque por filial (Regra Sigma RJ). */
export function classificarEstoque(saldo) {
  if (saldo === null || saldo === undefined) return null;
  if (saldo <= SALDO_SEM_ESTOQUE) return 'sem_estoque';
  if (saldo <= SALDO_BAIXO) return 'baixo';
  return 'ok';
}

export const ROTULO_ESTOQUE = {
  sem_estoque: { texto: 'Esgotado', classe: 'esgotado', icone: '🔴', cor: '#f87171' },
  baixo: { texto: 'Estoque Baixo', classe: 'baixo', icone: '🟡', cor: '#facc15' },
  ok: { texto: 'Disponível', classe: 'disponivel', icone: '🟢', cor: '#4ade80' },
  null: { texto: 'Saldo desconhecido', classe: 'neutro', icone: '⬜', cor: '#94a3b8' },
};

export function rotuloEstoque(status) {
  return ROTULO_ESTOQUE[status ?? 'null'] ?? ROTULO_ESTOQUE.null;
}

/**
 * Calcula uma linha da cotação com suporte a desconto percentual individual.
 * @param {object} item               registro do catálogo
 * @param {number} quantidade
 * @param {number} descontoPercentual porcentagem de 0 a 100
 */
export function calcularLinha(item, quantidade, descontoPercentual = 0) {
  const qtd = Math.max(0, Math.trunc(Number(quantidade) || 0));
  const unitario = item.valor_unitario_centavos;
  const desc = Math.max(0, Math.min(100, Number(descontoPercentual) || 0));

  if (unitario === null || unitario === undefined) {
    return {
      qtd,
      descontoPercentual: desc,
      valorBruto: null,
      valorDesconto: null,
      valorProdutos: null,
      valorIpi: null,
      valorComIpi: null,
      semPreco: true,
    };
  }

  const valorBruto = unitario * qtd;
  const valorDesconto = Math.round(valorBruto * (desc / 100));
  const valorProdutos = valorBruto - valorDesconto;
  // Arredonda o IPI UMA vez, aqui. Acumular fração linha a linha desvia o total.
  const valorIpi = Math.round(valorProdutos * (Number(item.ipi) || 0));

  return {
    qtd,
    descontoPercentual: desc,
    valorBruto,
    valorDesconto,
    valorProdutos,
    valorIpi,
    valorComIpi: valorProdutos + valorIpi,
    semPreco: false,
  };
}

/**
 * Totais da cotação. Soma TODAS as linhas — sem intervalo fixo.
 * @param {Array<{item, calculo}>} linhas
 */
export function calcularTotais(linhas) {
  let totalBruto = 0;
  let totalDesconto = 0;
  let totalProdutos = 0;
  let totalIpi = 0;
  let totalComIpi = 0;
  let itensSemPreco = 0;
  let itensSemEstoque = 0;
  let itensEstoqueBaixo = 0;
  let itensAcimaDoSaldo = 0;

  for (const { item, calculo } of linhas) {
    if (calculo.semPreco) itensSemPreco += 1;
    else {
      totalBruto += calculo.valorBruto ?? calculo.valorProdutos;
      totalDesconto += calculo.valorDesconto ?? 0;
      totalProdutos += calculo.valorProdutos;
      totalIpi += calculo.valorIpi;
      totalComIpi += calculo.valorComIpi;
    }
    if (item.status_estoque === 'sem_estoque') itensSemEstoque += 1;
    if (item.status_estoque === 'baixo') itensEstoqueBaixo += 1;
    if (item.saldo !== null && item.saldo !== undefined && calculo.qtd > item.saldo) {
      itensAcimaDoSaldo += 1;
    }
  }

  return {
    quantidadeItens: linhas.length,
    totalBruto,
    totalDesconto,
    totalProdutos,
    totalIpi,
    totalComIpi,
    itensSemPreco,
    itensSemEstoque,
    itensEstoqueBaixo,
    itensAcimaDoSaldo,
  };
}

/**
 * 🔒 Sanitização para o cliente — requisito de segurança, não de layout.
 *
 * Roda na GERAÇÃO do artefato, não no CSS. Se o dado nunca entra no HTML,
 * nenhum "inspecionar elemento", print ou seleção de texto o revela.
 */
const PROIBIDO_NO_CLIENTE = [
  'saldo', 'status_estoque', 'categoria',
  'comissao', 'aliquota_comissao', 'custo', 'margem',
];

export function sanitizarParaCliente(cotacao) {
  const limpar = (obj) => Object.fromEntries(
    Object.entries(obj).filter(([chave]) => !PROIBIDO_NO_CLIENTE.includes(chave)));

  return {
    ...limpar(cotacao),
    linhas: cotacao.linhas.map(({ item, calculo }) => ({
      item: limpar(item),
      calculo: limpar(calculo),
    })),
    totais: limpar(cotacao.totais),
  };
}
