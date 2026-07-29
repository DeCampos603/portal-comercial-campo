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

/** Aviso temporário no rodapé da tela. */
export function avisar(mensagem, tipo = 'info', ms = 3200) {
  document.querySelector('.torrada')?.remove();
  const torrada = comoElemento(`
    <div class="torrada faixa faixa--${tipo}" role="status" style="
      position:fixed; left:50%; transform:translateX(-50%);
      bottom:calc(var(--altura-rodape) + 16px); z-index:100;
      box-shadow:var(--sombra-alta); margin:0; max-width:90vw;">
      ${esc(mensagem)}
    </div>`);
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
