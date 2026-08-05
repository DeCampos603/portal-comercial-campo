/**
 * Bootstrap do portal: sessão, roteamento por hash e casca.
 *
 * Hash routing (#/cotacoes) porque o GitHub Pages não faz rewrite de
 * servidor — com History API, recarregar a página daria 404.
 */

import { entrar, sair, sessaoAtual, carregarPerfil, perfil } from './supabase.js';
import { carregar, atualizar, estado, aoMudar, sincronizarFila } from './nucleo/dados.js';
import { formatarDataHora, diasDesde } from './nucleo/moeda.js';
import { DIAS_ATE_TABELA_VELHA } from './config.js';

import { montarCotacoes } from './cotacoes/tela.js';
import { montarHistorico } from './cotacoes/historico.js';
import { montarCarteira } from './carteira/tela.js';
import { montarMapa } from './mapa/tela.js';
import { montarAgenda } from './agenda/tela.js';

const SECOES = [
  { hash: '#/cotacoes',  rotulo: 'Cotações',  icone: '💰', montar: montarCotacoes },
  { hash: '#/historico', rotulo: 'Histórico', icone: '🗂️', montar: montarHistorico },
  { hash: '#/carteira',  rotulo: 'Carteira',  icone: '👥', montar: montarCarteira },
  { hash: '#/mapa',      rotulo: 'Mapa',      icone: '🗺️', montar: montarMapa },
  { hash: '#/agenda',    rotulo: 'Agenda',    icone: '📅', montar: montarAgenda },
];

const el = (id) => document.getElementById(id);
let desmontarSecaoAtual = null;

// ------------------------------------------------------------- telas

function mostrar(qual) {
  el('carregando').classList.toggle('oculto', qual !== 'carregando');
  el('tela-login').classList.toggle('oculto', qual !== 'login');
  el('tela-sem-acesso').classList.toggle('oculto', qual !== 'sem-acesso');

  // ⚠️ A classe `oculto` é `display:none !important` — e !important vence
  //    estilo inline. Trocar só o `style.display` deixava o portal invisível
  //    com o DOM inteiro montado por baixo: tela preta, nada renderizado.
  //    Tem de tirar a classe E pôr o display:contents.
  const portal = el('tela-portal');
  portal.classList.toggle('oculto', qual !== 'portal');
  portal.style.display = qual === 'portal' ? 'contents' : 'none';
}

// ------------------------------------------------------------- login

el('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = el('login-enviar');
  const erro = el('login-erro');
  erro.classList.add('oculto');
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try {
    const p = await entrar(el('login-email').value, el('login-senha').value);
    el('login-senha').value = '';
    if (!p) { mostrar('sem-acesso'); return; }
    await iniciarPortal();
  } catch (e) {
    erro.textContent = e.message;
    erro.classList.remove('oculto');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

el('sem-acesso-sair').addEventListener('click', async () => {
  await sair();
  mostrar('login');
});

el('btn-sair').addEventListener('click', async () => {
  if (estado.pendentes > 0 &&
      !confirm(`Há ${estado.pendentes} alteração(ões) ainda não sincronizada(s). Sair mesmo assim?`)) {
    return;
  }
  await sair();
  location.hash = '';
  mostrar('login');
});

el('btn-atualizar').addEventListener('click', () => atualizar());

// ---------------------------------------------------------- navegação

function montarAbas() {
  const html = (classeIcone) => SECOES.map((s) => `
    <a href="${s.hash}" data-hash="${s.hash}">
      <span class="${classeIcone}" aria-hidden="true">${s.icone}</span>
      <span>${s.rotulo}</span>
    </a>`).join('');
  el('abas-desktop').innerHTML = html('');
  el('abas-mobile').innerHTML = html('icone');
}

function marcarAbaAtiva(hash) {
  document.querySelectorAll('[data-hash]').forEach((a) => {
    if (a.dataset.hash === hash) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function rotear() {
  const hash = location.hash || SECOES[0].hash;
  const secao = SECOES.find((s) => s.hash === hash) ?? SECOES[0];
  marcarAbaAtiva(secao.hash);

  if (desmontarSecaoAtual) { desmontarSecaoAtual(); desmontarSecaoAtual = null; }
  const alvo = el('conteudo');
  alvo.innerHTML = '';
  desmontarSecaoAtual = secao.montar(alvo) ?? null;
  alvo.focus({ preventScroll: true });
}

window.addEventListener('hashchange', rotear);

// ------------------------------------------------- indicador de estado

function atualizarIndicador() {
  const alvo = el('indicador-sinc');
  let classe = 'sinc';
  let texto;

  if (estado.sincronizando) texto = '🔄 Sincronizando…';
  else if (estado.pendentes > 0) { classe += ' sinc--pendente'; texto = `⏳ ${estado.pendentes} pendente(s)`; }
  else if (estado.erro) { classe += ' sinc--erro'; texto = '⚠️ Erro'; }
  else if (estado.daCache) { classe += ' sinc--pendente'; texto = '📴 Offline'; }
  else texto = '✅ Sincronizado';

  alvo.className = classe;
  alvo.textContent = texto;
  alvo.title = estado.atualizadoEm
    ? `Dados de ${formatarDataHora(estado.atualizadoEm)}`
    : 'Sem dados carregados';
}

/** Faixa de aviso no topo do conteúdo, quando houver o que avisar. */
export function faixaDeEstado() {
  const avisos = [];

  if (estado.erro) {
    avisos.push(`<div class="faixa faixa--risco">⚠️ ${estado.erro}</div>`);
  } else if (estado.daCache && estado.atualizadoEm) {
    avisos.push(`<div class="faixa faixa--atencao">
      📴 Sem conexão — mostrando dados de ${formatarDataHora(estado.atualizadoEm)}.
    </div>`);
  }

  const item = estado.catalogo.find((i) => i.atualizado_em);
  const idade = item ? diasDesde(item.atualizado_em) : null;
  if (idade !== null && idade > DIAS_ATE_TABELA_VELHA) {
    avisos.push(`<div class="faixa faixa--atencao">
      📅 Tabela de preços de ${idade} dias atrás — pode estar desatualizada.
    </div>`);
  }

  return avisos.join('');
}

// ------------------------------------------------------------- início

async function iniciarPortal() {
  mostrar('portal');
  montarAbas();
  if (!location.hash) location.hash = SECOES[0].hash;
  rotear();

  aoMudar(() => { atualizarIndicador(); });
  atualizarIndicador();

  await carregar();
  rotear();                   // redesenha com os dados já em mãos
}

async function iniciar() {
  mostrar('carregando');
  try {
    const sessao = await sessaoAtual();
    // Marca que o JavaScript rodou: desarma o vigia do index.html.
    window.__portalIniciou = true;

    if (!sessao) { mostrar('login'); return; }

    const p = await carregarPerfil();
    if (!p) { mostrar('sem-acesso'); return; }

    await iniciarPortal();
  } catch (e) {
    window.__portalIniciou = true;
    console.error('Falha ao iniciar:', e);
    // Sem sessão utilizável, a tela de login é o destino seguro — nunca
    // deixar o usuário parado num "Carregando…" que não termina.
    mostrar('login');
    const erro = el('login-erro');
    erro.textContent = `Não consegui verificar a sessão: ${e.message}`;
    erro.classList.remove('oculto');
  }
}

// Service Worker com escopo relativo — o Pages serve em subdiretório.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) =>
      console.warn('Service Worker não registrado:', e.message));
  });
}

window.addEventListener('online', () => { sincronizarFila(); atualizar(); });
window.addEventListener('offline', () => { estado.daCache = true; atualizarIndicador(); });

iniciar();
