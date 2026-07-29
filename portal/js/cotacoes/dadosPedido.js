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

export const pedido = {
  ler: () => ler(CHAVE_PEDIDO, PEDIDO_PADRAO),
  gravar: (v) => gravar(CHAVE_PEDIDO, v),

  /**
   * Sugere o próximo número, preservando prefixo e largura:
   * "MJ-0042" → "MJ-0043".
   */
  proximoNumero() {
    const atual = this.ler().numero || '';
    const casa = atual.match(/^(.*?)(\d+)(\D*)$/);
    if (!casa) return atual;
    const [, prefixo, digitos, sufixo] = casa;
    const proximo = String(Number(digitos) + 1).padStart(digitos.length, '0');
    return `${prefixo}${proximo}${sufixo}`;
  },

  /**
   * Número automático de verdade: não exige que alguém digite o primeiro.
   *
   * Deriva do HISTÓRICO — conta as cotações do ano e soma um. Assim a
   * sequência sobrevive a trocar de computador, limpar o navegador ou
   * outro representante emitir pedidos: o banco é a fonte, não o
   * localStorage.
   *
   * Formato AAAA-NNNN: legível, ordenável e reinicia a cada ano.
   *
   * @param {Array} cotacoes  estado.cotacoes
   */
  gerarNumero(cotacoes = []) {
    const ano = new Date().getFullYear();
    const prefixo = `${ano}-`;

    let maior = 0;
    for (const c of cotacoes) {
      const casa = String(c.numero || '').match(/^(\d{4})-(\d+)$/);
      if (casa && casa[1] === String(ano)) {
        maior = Math.max(maior, Number(casa[2]));
      }
    }
    return `${prefixo}${String(maior + 1).padStart(4, '0')}`;
  },

  /**
   * Devolve o número a usar agora. Se a numeração é automática, sempre
   * recalcula a partir do histórico — evita repetir número quando duas
   * cotações são feitas no mesmo dia em máquinas diferentes.
   */
  numeroAtual(cotacoes = []) {
    const atual = this.ler();
    if (!atual.numeroAutomatico) return atual.numero || '';
    const numero = this.gerarNumero(cotacoes);
    if (numero !== atual.numero) this.gravar({ ...atual, numero });
    return numero;
  },

  /** Chamado ao gerar o PDF: avança a numeração manual. */
  avancarNumero() {
    const atual = this.ler();
    if (!atual.numeroAutomatico || !atual.numero) return;
    this.gravar({ ...atual, numero: this.proximoNumero() });
  },
};
