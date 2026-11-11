/**
 * Dados do cabeçalho e do rodapé do pedido, preenchidos pelo representante.
 *
 * Divididos em dois grupos, porque mudam em ritmos diferentes:
 *
 *   EMPRESA  — CNPJ, I.E., contato da representação. Digitados UMA vez e
 *              reaproveitados para sempre.
 *   PEDIDO   — número, condições de pagamento, prazo, validade. Variam por
 *              cotação, mas o último valor fica lembrado: na prática o
 *              representante repete as mesmas condições quase sempre.
 *
 * Tudo em localStorage. São dados do negócio dele, não de cliente — não há
 * motivo para ocupar o banco com isso.
 */

const CHAVE_EMPRESA = 'dados_empresa';
const CHAVE_PEDIDO = 'dados_pedido';

const EMPRESA_PADRAO = {
  razaoSocial: 'M A JOAQUIM REPRESENTAÇÃO',
  cnpj: '',
  inscricaoEstadual: '',
  telefone: '',
  email: '',
};

const PEDIDO_PADRAO = {
  numero: '',
  numeroAutomatico: true,
  condicoesPagamento: '',
  prazoEntrega: '',
  frete: 'CIF',            // opção mais comum; o usuário troca no botão
  validadeDiasUteis: 7,    // regra fixa combinada com o usuário
};

function ler(chave, padrao) {
  try {
    return { ...padrao, ...JSON.parse(localStorage.getItem(chave) || '{}') };
  } catch {
    return { ...padrao };
  }
}

function gravar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch { /* modo privativo: segue sem lembrar */ }
}

export const empresa = {
  ler: () => ler(CHAVE_EMPRESA, EMPRESA_PADRAO),
  gravar: (v) => gravar(CHAVE_EMPRESA, v),
  /** Falta algo essencial para o pedido sair completo? */
  pendencias() {
    const e = this.ler();
    const faltando = [];
    if (!e.cnpj?.trim()) faltando.push('CNPJ');
    if (!e.inscricaoEstadual?.trim()) faltando.push('Inscrição Estadual');
    return faltando;
  },
};

export function normalizarNumeroPedido(valor) {
  return String(valor ?? '').trim().toUpperCase();
}

export function numerosDeCotacaoEmUso(cotacoes = [], ignorarId = null) {
  const usados = new Set();
  for (const c of cotacoes) {
    if (!c || (ignorarId && c.id === ignorarId)) continue;
    const norm = normalizarNumeroPedido(c.numero);
    if (norm) usados.add(norm);
  }
  return usados;
}

export function numeroCotacaoExiste(numero, cotacoes = [], ignorarId = null) {
  const norm = normalizarNumeroPedido(numero);
  if (!norm) return false;
  return numerosDeCotacaoEmUso(cotacoes, ignorarId).has(norm);
}

export const pedido = {
  ler: () => ler(CHAVE_PEDIDO, PEDIDO_PADRAO),
  gravar: (v) => gravar(CHAVE_PEDIDO, v),

  /**
   * Sugere o próximo número, preservando prefixo e largura:
   * "MJ-0042" → "MJ-0043".
   */
  proximoNumero(base = null) {
    const atual = String(base ?? (this.ler().numero || '')).trim();
    const casa = atual.match(/^(.*?)(\d+)(\D*)$/);
    if (!casa) return atual;
    const [, prefixo, digitos, sufixo] = casa;
    const proximo = String(Number(digitos) + 1).padStart(digitos.length, '0');
    return `${prefixo}${proximo}${sufixo}`;
  },

  /**
   * Avança um código base até encontrar um número que não esteja em uso no histórico.
   */
  proximoNumeroLivre(cotacoes = [], base = null, ignorarId = null) {
    const usados = numerosDeCotacaoEmUso(cotacoes, ignorarId);
    let atual = String(base ?? (this.ler().numero || '')).trim();
    if (!atual) return this.gerarNumero(cotacoes, ignorarId);
    if (!usados.has(normalizarNumeroPedido(atual))) return atual;

    for (let i = 0; i < 1000; i += 1) {
      const proximo = this.proximoNumero(atual);
      if (!proximo || proximo === atual) break;
      atual = proximo;
      if (!usados.has(normalizarNumeroPedido(atual))) return atual;
    }
    return this.gerarNumero(cotacoes, ignorarId);
  },

  /**
   * Número automático único derivado do histórico.
   *
   * Formato AAAA-NNNN: legível, ordenável, reinicia a cada ano e pula
   * qualquer código já existente para impedir duplicatas.
   *
   * @param {Array} cotacoes       estado.cotacoes (+ números remotos)
   * @param {string|null} ignorarId  id da cotação em edição, se houver
   */
  gerarNumero(cotacoes = [], ignorarId = null) {
    const ano = new Date().getFullYear();
    const prefixo = `${ano}-`;
    const usados = numerosDeCotacaoEmUso(cotacoes, ignorarId);

    let maior = 0;
    for (const c of cotacoes) {
      const casa = String(c?.numero || '').trim().match(/^(\d{4})-(\d+)$/);
      if (casa && casa[1] === String(ano)) {
        maior = Math.max(maior, Number(casa[2]));
      }
    }
    let seq = maior + 1;
    let candidato = `${prefixo}${String(seq).padStart(4, '0')}`;
    while (usados.has(normalizarNumeroPedido(candidato))) {
      seq += 1;
      candidato = `${prefixo}${String(seq).padStart(4, '0')}`;
    }
    return candidato;
  },

  /**
   * Devolve o número a exibir/usar. Quando a cotação já foi salva
   * (`numeroTravado`), mantém esse mesmo código em vez de gerar outro.
   */
  numeroAtual(cotacoes = [], numeroTravado = null, ignorarId = null) {
    const atual = this.ler();
    if (!atual.numeroAutomatico) return String(numeroTravado || atual.numero || '').trim();
    if (numeroTravado) return String(numeroTravado).trim();
    return this.gerarNumero(cotacoes, ignorarId);
  },

  /** Ao iniciar uma nova cotação em modo manual, avança para o próximo código livre. */
  avancarNumero(cotacoes = [], ignorarId = null) {
    const atual = this.ler();
    if (atual.numeroAutomatico || !atual.numero) return;
    const proximo = this.proximoNumeroLivre(cotacoes, this.proximoNumero(atual.numero), ignorarId);
    this.gravar({ ...atual, numero: proximo });
  },
};
