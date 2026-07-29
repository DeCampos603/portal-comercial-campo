/**
 * Histórico de compra de um item, por cliente.
 *
 * A pergunta que isto responde, na frente do cliente: "ele já comprou esta
 * peça? quanto? quando? está na hora de repor?"
 *
 * Sem isso, o representante depende de memória para 328 clientes × 521
 * itens. Com isso, a cotação vira sugestão fundamentada — que é o caminho
 * para a previsão de compra que o usuário quer.
 */

import { estado } from '../nucleo/dados.js';
import { diasDesde } from '../nucleo/moeda.js';

/**
 * Levantamento de um item para um cliente.
 * @returns {object|null} null quando nunca foi cotado
 */
export function historicoDoItem(clienteId, codigoSigma) {
  if (!clienteId) return null;

  const ocorrencias = [];
  for (const cotacao of estado.cotacoes) {
    if (cotacao.cliente_id !== clienteId) continue;
    if (cotacao.situacao === 'rascunho') continue;

    for (const item of (cotacao.itens || [])) {
      if (item.codigo_sigma !== codigoSigma) continue;
      ocorrencias.push({
        data: cotacao.data,
        quantidade: Number(item.quantidade) || 0,
        valorUnitario: item.valor_unitario_centavos,
      });
    }
  }

  if (!ocorrencias.length) return null;
  ocorrencias.sort((a, b) => String(b.data).localeCompare(String(a.data)));

  const quantidadeTotal = ocorrencias.reduce((a, o) => a + o.quantidade, 0);
  const ultima = ocorrencias[0];
  const diasDaUltima = diasDesde(ultima.data);

  // Intervalo médio entre compras: precisa de pelo menos duas ocorrências.
  let intervaloMedio = null;
  if (ocorrencias.length > 1) {
    const maisAntiga = new Date(`${ocorrencias[ocorrencias.length - 1].data}T12:00`);
    const maisRecente = new Date(`${ultima.data}T12:00`);
    const dias = Math.round((maisRecente - maisAntiga) / 86400000);
    if (dias > 0) intervaloMedio = Math.round(dias / (ocorrencias.length - 1));
  }

  // Quantidade típica: a MEDIANA, não a média. Um pedido atípico de 500
  // unidades distorceria a média e faria o portal sugerir besteira.
  const quantidades = ocorrencias.map((o) => o.quantidade).sort((a, b) => a - b);
  const meio = Math.floor(quantidades.length / 2);
  const quantidadeTipica = quantidades.length % 2
    ? quantidades[meio]
    : Math.round((quantidades[meio - 1] + quantidades[meio]) / 2);

  return {
    vezes: ocorrencias.length,
    quantidadeTotal,
    quantidadeTipica,
    ultimaData: ultima.data,
    ultimaQuantidade: ultima.quantidade,
    ultimoValorUnitario: ultima.valorUnitario,
    diasDaUltima,
    intervaloMedio,
    // Passou do próprio ritmo? É o gatilho da sugestão de recompra.
    atrasado: intervaloMedio !== null && diasDaUltima > intervaloMedio,
    diasDeAtraso: intervaloMedio !== null ? diasDaUltima - intervaloMedio : null,
    ocorrencias,
  };
}

/**
 * Itens que o cliente costuma comprar e estão "vencidos" pelo próprio ritmo.
 * Ordenados pelo mais atrasado — é a lista do que oferecer na visita.
 */
export function itensParaRepor(clienteId, limite = 8) {
  if (!clienteId) return [];

  const codigos = new Set();
  for (const cotacao of estado.cotacoes) {
    if (cotacao.cliente_id !== clienteId || cotacao.situacao === 'rascunho') continue;
    for (const item of (cotacao.itens || [])) codigos.add(item.codigo_sigma);
  }

  const sugestoes = [];
  for (const codigo of codigos) {
    const h = historicoDoItem(clienteId, codigo);
    if (!h?.atrasado) continue;
    const item = estado.catalogo.find((i) => i.codigo_sigma === codigo);
    if (item) sugestoes.push({ item, historico: h });
  }

  return sugestoes
    .sort((a, b) => b.historico.diasDeAtraso - a.historico.diasDeAtraso)
    .slice(0, limite);
}

/** Selo compacto, para caber ao lado do item na busca e na linha da cotação. */
export function seloHistorico(h) {
  if (!h) return '';

  if (h.atrasado) {
    return `<span class="selo selo--atencao" title="Compra a cada ~${h.intervaloMedio} dias; última há ${h.diasDaUltima}">
      🔁 repor · ${h.diasDeAtraso}d além do ritmo</span>`;
  }
  if (h.intervaloMedio !== null) {
    return `<span class="selo selo--info" title="${h.vezes} compras registradas">
      📆 a cada ~${h.intervaloMedio}d · última há ${h.diasDaUltima}d</span>`;
  }
  return `<span class="selo selo--info" title="Comprado uma vez">
    ✓ já comprou · há ${h.diasDaUltima}d</span>`;
}
