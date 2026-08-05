/** Utilidades de interface compartilhadas pelas telas. */

/** Escapa texto antes de injetar em HTML. Todo dado do banco passa por aqui. */
export function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Cria elemento a partir de HTML. */
export function comoElemento(html) {
  const molde = document.createElement('template');
  molde.innerHTML = html.trim();
  return molde.content.firstElementChild;
}

/**
 * Ícones da navegação — um conjunto só, desenhado com a mesma régua.
 *
 * Substituem emoji. Emoji não são um conjunto: 💰 é colorido e cheio, 🗂️ tem
 * outra proporção, e cada sistema desenha o seu. Lado a lado numa barra de
 * navegação, nunca alinham nem pesam igual — é o tipo de detalhe que faz uma
 * interface parecer montada aos pedaços sem que se saiba apontar o motivo.
 *
 * Todos com a mesma caixa (24), a mesma espessura (1.75) e `currentColor`,
 * então herdam a cor do estado da aba sem uma regra a mais.
 */
const TRACOS = {
  cotacoes: '<path d="M7 4h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/>'
    + '<path d="M13 4v5h5"/><path d="M9.5 13.5h5M9.5 17h3"/>',
  historico: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l1.6 2h7.4A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z"/>'
    + '<path d="M4 11h16"/>',
  carteira: '<circle cx="9" cy="8.5" r="3"/>'
    + '<path d="M3.5 19a5.5 5.5 0 0 1 11 0"/>'
    + '<path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-2-4.2"/>',
  mapa: '<path d="M12 21s6.5-5.7 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.3 12 21 12 21Z"/>'
    + '<circle cx="12" cy="10.5" r="2.4"/>',
  agenda: '<rect x="4" y="5.5" width="16" height="14" rx="1.8"/>'
    + '<path d="M4 10h16M9 3.5v4M15 3.5v4"/><path d="M8.5 14h3"/>',
};

/** @param {keyof TRACOS} nome */
export function icone(nome) {
  const tracos = TRACOS[nome];
  if (!tracos) return '';
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">${tracos}</svg>`;
}

/** Aviso temporário no rodapé da tela. */
export function avisar(mensagem, tipo = 'info', ms = 3200) {
  document.querySelector('.torrada')?.remove();
  // Sem estilo inline: posição, animação e cor vivem no CSS. O `transform`
  // inline que existia aqui vencia o da animação de entrada, e a torrada
  // aparecia deslocada meia largura para a direita ao ser animada.
  const torrada = comoElemento(
    `<div class="torrada torrada--${tipo}" role="status">${esc(mensagem)}</div>`);
  document.body.appendChild(torrada);
  setTimeout(() => torrada.remove(), ms);
}

/** Confirmação com nome do alvo — nunca "tem certeza?" genérico. */
export function confirmar(mensagem) {
  return window.confirm(mensagem);
}

/** Painel lateral. Devolve uma função para fechar. */
export function abrirPainel(titulo, conteudoHtml, aoFechar) {
  document.querySelector('.painel')?.remove();

  const painel = comoElemento(`
    <div class="painel" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="painel__caixa">
        <div class="painel__cabecalho">
          <h2 style="flex:1;margin:0">${esc(titulo)}</h2>
          <button class="btn btn--fantasma btn--pequeno" data-fechar aria-label="Fechar">✕</button>
        </div>
        <div class="painel__corpo">${conteudoHtml}</div>
      </div>
    </div>`);

  const fechar = () => {
    painel.remove();
    document.removeEventListener('keydown', aoTecla);
    aoFechar?.();
  };
  const aoTecla = (e) => { if (e.key === 'Escape') fechar(); };

  painel.addEventListener('click', (e) => { if (e.target === painel) fechar(); });
  painel.querySelector('[data-fechar]').addEventListener('click', fechar);
  document.addEventListener('keydown', aoTecla);
  document.body.appendChild(painel);

  painel.querySelector('input, textarea, select, button')?.focus();
  return fechar;
}

/** Estado vazio explicando o porquê e oferecendo a próxima ação. */
export function vazio(icone, titulo, detalhe = '', acaoHtml = '') {
  return `<div class="vazio">
    <span class="vazio__icone">${icone}</span>
    <p class="forte" style="margin-bottom:4px">${esc(titulo)}</p>
    ${detalhe ? `<p class="pequeno" style="margin-bottom:12px">${esc(detalhe)}</p>` : ''}
    ${acaoHtml}
  </div>`;
}

/** Selo de status comercial do cliente. Cor + ícone + texto, nunca só cor. */
export function seloStatus(status) {
  const mapa = {
    'Atrasado':    ['risco',   '🔴'],
    'Com Título':  ['atencao', '🟡'],
    'Sem Título':  ['ok',      '🟢'],
  };
  const [classe, icone] = mapa[status] ?? ['', '⬜'];
  return `<span class="selo ${classe ? `selo--${classe}` : ''}">${icone} ${esc(status || 'Sem status')}</span>`;
}

/**
 * As três carteiras, em um lugar só.
 *
 * `ativo` chegou depois da carga inicial — os clientes que efetivamente
 * compram não estavam no portal, só os 300 inativos e os 28 em recuperação.
 * A definição vive aqui porque cinco telas dependiam dela e cada uma tinha
 * o seu `origem === 'recuperacao'` solto: acrescentar uma classificação
 * significava lembrar de mexer em todas, e esquecer uma não dava erro —
 * só fazia a carteira nova sumir daquela tela.
 *
 * `prioridade` é o peso na fila de visitas: quem compra hoje vale mais que
 * quem parou de comprar.
 */
export const ORIGENS = {
  ativo:       { rotulo: 'Ativos',         selo: '💚 ativo',        classe: 'ok',   prioridade: 50 },
  recuperacao: { rotulo: 'Em recuperação', selo: '⭐ recuperação',  classe: 'info', prioridade: 40 },
  inativo:     { rotulo: 'Inativos',       selo: '',                classe: '',     prioridade: 0 },
};

/** Selo da carteira. Devolve '' para inativo — é o caso comum, não merece ruído. */
export function seloOrigem(origem) {
  const o = ORIGENS[origem];
  if (!o?.selo) return '';
  return `<span class="selo selo--${o.classe}">${o.selo}</span>`;
}

/** Link de telefone / WhatsApp. */
export function linkContato(cliente) {
  const partes = [];
  if (cliente.telefone) {
    const digitos = String(cliente.telefone).replace(/\D/g, '');
    partes.push(`<a class="btn btn--pequeno" href="tel:${esc(digitos)}">📞 Ligar</a>`);
  }
  if (cliente.whatsapp) {
    partes.push(`<a class="btn btn--pequeno" target="_blank" rel="noopener"
      href="https://wa.me/${esc(String(cliente.whatsapp).replace(/\D/g, ''))}">💬 WhatsApp</a>`);
  }
  return partes.join(' ');
}

/** Endereço em uma linha. */
export function enderecoLinha(c) {
  return [c.logradouro, c.bairro, c.cidade, c.uf].filter(Boolean).join(', ');
}

/** Abre o app de navegação do celular — sem API, sem custo. */
export function linkRota(cliente) {
  if (cliente.lat == null) return '';
  return `<a class="btn btn--pequeno" target="_blank" rel="noopener"
    href="https://www.google.com/maps/dir/?api=1&destination=${cliente.lat},${cliente.lng}">🧭 Rota</a>`;
}
