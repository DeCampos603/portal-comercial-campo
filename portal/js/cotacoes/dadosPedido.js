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
  validade: '',
  frete: '',
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

export const pedido = {
  ler: () => ler(CHAVE_PEDIDO, PEDIDO_PADRAO),
  gravar: (v) => gravar(CHAVE_PEDIDO, v),

  /**
   * Sugere o próximo número, quando a numeração automática está ligada.
   * Preserva o prefixo e a largura: "MJ-0042" → "MJ-0043".
   */
  proximoNumero() {
    const atual = this.ler().numero || '';
    const casa = atual.match(/^(.*?)(\d+)(\D*)$/);
    if (!casa) return atual;
    const [, prefixo, digitos, sufixo] = casa;
    const proximo = String(Number(digitos) + 1).padStart(digitos.length, '0');
    return `${prefixo}${proximo}${sufixo}`;
  },

  /** Chamado ao gerar o PDF: avança a numeração para a próxima cotação. */
  avancarNumero() {
    const atual = this.ler();
    if (!atual.numeroAutomatico || !atual.numero) return;
    this.gravar({ ...atual, numero: this.proximoNumero() });
  },
};
