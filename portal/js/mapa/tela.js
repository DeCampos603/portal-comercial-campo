/**
 * Mapa — os 328 clientes plotados no Rio.
 *
 * Responde a pergunta que a planilha nunca respondeu: "quem está perto de
 * quem?". E, em campo, a mais útil de todas: "terminei aqui, quem tem por perto?"
 *
 * Leaflet + OpenStreetMap: sem chave de API. Em site estático, qualquer chave
 * ficaria visível no código-fonte.
 */

import { estado, aoMudar } from '../nucleo/dados.js';
import { MAPA_CENTRO, MAPA_ZOOM } from '../config.js';
import { esc, vazio, seloStatus, seloOrigem, ORIGENS, linkContato, linkRota, enderecoLinha, avisar } from '../nucleo/ui.js';
import { formatarData } from '../nucleo/moeda.js';
import { filtros, clientesFiltrados, abrirFicha } from '../carteira/tela.js';
import { agendarPara } from '../agenda/tela.js';

const CORES = {
  'Atrasado':   '#b3261e',
  'Com Título': '#a86a05',
  'Sem Título': '#1a7f4b',
};

let mapa = null;
let camadaPinos = null;
let marcadorEu = null;
let raioKm = null;
let minhaPosicao = null;

export function montarMapa(alvo) {
  if (!estado.clientes.length) {
    alvo.innerHTML = vazio('🗺️', 'Carteira não carregada',
      estado.erro || 'Aguardando dados do servidor.');
    return null;
  }

  alvo.innerHTML = `
    <div class="cartao" style="margin-bottom:12px">
      <div class="cartao__corpo" style="padding:10px 16px">
        <div class="linha" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn--pequeno" id="mapa-perto">📍 Perto de mim</button>
          <select class="campo" id="mapa-raio" style="width:auto">
            <option value="">Sem raio</option>
            <option value="2">2 km</option><option value="5">5 km</option>
            <option value="10">10 km</option><option value="20">20 km</option>
          </select>
          <span class="espaco" style="flex:1"></span>
          <span class="pequeno suave" id="mapa-contagem"></span>
        </div>
        <div class="linha pequeno" style="gap:12px;flex-wrap:wrap;margin-top:8px">
          ${Object.keys(CORES).map((s) => seloStatus(s)).join(' ')}
          <span class="suave minusculo">⭐ contorno = em recuperação · ◇ losango = localização aproximada</span>
        </div>
      </div>
    </div>
    <div class="cartao">
      <div id="mapa-tela" style="height:min(70vh,640px);border-radius:var(--raio)"></div>
    </div>`;

  criarMapa();
  const soltar = aoMudar(() => desenharPinos());
  desenharPinos();
  ligar(alvo);

  return () => { soltar(); destruir(); };
}

function destruir() {
  if (mapa) { mapa.remove(); mapa = null; camadaPinos = null; marcadorEu = null; }
}

/**
 * Base do mapa — CARTO Voyager, sobre os mesmos dados do OpenStreetMap.
 *
 * O estilo padrão do OSM foi desenhado para EDITAR o mapa: mostra ícone de
 * cada ponto de interesse, linha de balsa, uso do solo em cores fortes. Numa
 * tela com 378 pinos por cima, isso vira ruído — o pino compete com o mapa
 * em vez de se destacar dele.
 *
 * Voyager mantém a hierarquia de vias legível (que é o que serve para montar
 * roteiro) e apaga o resto. Medido no mesmo tile do Centro do Rio: 19,9 KB
 * contra 22,8 KB do OSM, e resposta de 9 ms contra 191 ms.
 *
 * `{r}` com `detectRetina` pede a versão @2x só em tela que a aproveita: no
 * celular do representante o texto do mapa deixa de sair borrado, e no
 * monitor comum não se paga o dobro de bytes por nada.
 *
 * ⚠️ A atribuição do OSM E a da CARTO são exigência de licença das duas.
 *    Não remover nenhuma das duas.
 */
/**
 * 🔴 SEMPRE a base clara, mesmo com o portal em tema escuro.
 *
 *    A primeira versão seguia `prefers-color-scheme` e trocava para a base
 *    escura junto com a interface. Parecia coerente e era pior de usar: no
 *    mapa escuro as vias somem no fundo e os nomes de bairro ficam ilegíveis
 *    à luz do dia, que é quando se monta roteiro.
 *
 *    O mapa não é parte da moldura da interface — é o DOCUMENTO que está
 *    sendo lido. Um documento se imprime em papel branco independente da cor
 *    da mesa. Legibilidade ganha de harmonia cromática aqui.
 */
const BASE_CLARA =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

const ATRIBUICAO =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  + ' · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

function criarMapa() {
  mapa = L.map('mapa-tela', {
    center: MAPA_CENTRO,
    zoom: MAPA_ZOOM,
    preferCanvas: true,       // essencial com centenas de pinos
    zoomControl: true,
  });

  L.tileLayer(BASE_CLARA, {
    attribution: ATRIBUICAO,
    subdomains: 'abcd',
    maxZoom: 20,
    detectRetina: true,
  }).addTo(mapa);

  camadaPinos = L.layerGroup().addTo(mapa);
}

function distanciaKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r);
  const y = (b[0] - a[0]) * r;
  return R * Math.sqrt(x * x + y * y);
}

function desenharPinos() {
  if (!mapa || !camadaPinos) return;
  camadaPinos.clearLayers();

  let lista = clientesFiltrados().filter((c) => c.lat != null && c.lng != null);

  if (raioKm && minhaPosicao) {
    lista = lista.filter((c) => distanciaKm(minhaPosicao, [c.lat, c.lng]) <= raioKm);
  }

  for (const c of lista) {
    const cor = CORES[c.status] ?? '#5b6875';
    // Localização aproximada ganha forma diferente — cor sozinha não basta,
    // e um pino "cidade" não sustenta roteiro.
    const aproximado = c.geo_precisao && c.geo_precisao !== 'rua';

    // Contorno destaca quem é carteira de trabalho — ativo e em recuperação.
    // O preenchimento continua sendo o status financeiro: são duas
    // informações diferentes e o representante precisa das duas no mesmo pino.
    const destacado = ORIGENS[c.origem]?.prioridade > 0;

    const marcador = L.circleMarker([c.lat, c.lng], {
      radius: 7,
      fillColor: cor,
      color: destacado ? '#14538a' : '#fff',
      weight: destacado ? 3 : 1.5,
      opacity: 1,
      fillOpacity: aproximado ? 0.45 : 0.9,
    });

    marcador.bindPopup(() => popup(c), { maxWidth: 300 });
    marcador.addTo(camadaPinos);
  }

  const contagem = document.getElementById('mapa-contagem');
  if (contagem) {
    const semGeo = clientesFiltrados().filter((c) => c.lat == null).length;
    contagem.textContent = `${lista.length} no mapa` + (semGeo ? ` · ${semGeo} sem localização` : '');
  }
}

function popup(c) {
  const precisao = { rua: '', bairro: ' (aproximado)', cidade: ' (muito aproximado)' };
  return `<div style="min-width:220px;font-family:var(--fonte)">
    <div style="font-weight:700;margin-bottom:4px">${esc(c.nome)}</div>
    <div style="margin-bottom:6px">${seloStatus(c.status)}
      ${seloOrigem(c.origem)}</div>
    <div style="font-size:.8rem;margin-bottom:6px">
      📍 ${esc(enderecoLinha(c))}${esc(precisao[c.geo_precisao] ?? '')}<br>
      ${c.telefone ? `📞 ${esc(c.telefone)}<br>` : ''}
      <span style="color:var(--cor-texto-suave)">Última visita: ${
        c.ultima_visita ? formatarData(c.ultima_visita) : 'nunca'}</span>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button class="btn btn--pequeno" data-pop-agendar="${esc(c.id)}">📅 Agendar</button>
      <button class="btn btn--pequeno" data-pop-ficha="${esc(c.id)}">📋 Ficha</button>
      ${linkRota(c)} ${linkContato(c)}
    </div>
  </div>`;
}

function ligar(alvo) {
  alvo.querySelector('#mapa-perto')?.addEventListener('click', () => {
    if (!navigator.geolocation) { avisar('Este navegador não informa a localização.', 'atencao'); return; }
    avisar('Localizando…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        minhaPosicao = [pos.coords.latitude, pos.coords.longitude];
        if (marcadorEu) marcadorEu.remove();
        marcadorEu = L.circleMarker(minhaPosicao, {
          radius: 9, fillColor: '#14538a', color: '#fff', weight: 3, fillOpacity: 1,
        }).addTo(mapa).bindPopup('Você está aqui');
        mapa.setView(minhaPosicao, 13);
        desenharPinos();
      },
      (erro) => avisar(`Não consegui localizar: ${erro.message}`, 'risco', 5000),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  });

  alvo.querySelector('#mapa-raio')?.addEventListener('change', (e) => {
    raioKm = e.target.value ? Number(e.target.value) : null;
    if (raioKm && !minhaPosicao) {
      avisar('Toque em "Perto de mim" primeiro para definir o centro do raio.', 'atencao', 4000);
    }
    desenharPinos();
  });

  // Os botões do popup nascem depois — delegação no documento.
  document.addEventListener('click', aoClicarPopup);
}

function aoClicarPopup(e) {
  const agendar = e.target.closest('[data-pop-agendar]');
  if (agendar) { mapa?.closePopup(); agendarPara(agendar.dataset.popAgendar); return; }
  const ficha = e.target.closest('[data-pop-ficha]');
  if (ficha) { mapa?.closePopup(); abrirFicha(ficha.dataset.popFicha); }
}
