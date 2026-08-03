/**
 * Service Worker — casca offline.
 *
 * Guarda apenas o CÓDIGO (HTML, CSS, JS, Leaflet). Os dados de negócio ficam
 * no IndexedDB, gerenciados por nucleo/deposito.js — misturar os dois faria
 * o cache de dados expirar junto com um deploy de código.
 *
 * ⚠️ Caminhos relativos: o GitHub Pages serve em subdiretório.
 */

const VERSAO = 'portal-v7';

const CASCA = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/base.css',
  './assets/css/componentes.css',
  './assets/css/impressao.css',
  './assets/vendor/supabase.js',
  './assets/vendor/leaflet/leaflet.js',
  './assets/vendor/leaflet/leaflet.css',
  './js/app.js',
  './js/config.js',
  './js/supabase.js',
  './js/nucleo/moeda.js',
  './js/nucleo/busca.js',
  './js/nucleo/ui.js',
  './js/nucleo/deposito.js',
  './js/nucleo/dados.js',
  './js/cotacoes/calculo.js',
  './js/cotacoes/tela.js',
  './js/cotacoes/exportar.js',
  './js/cotacoes/dadosPedido.js',
  './js/cotacoes/logos.js',
  './js/cotacoes/historicoItem.js',
  './js/nucleo/diasUteis.js',
  './js/carteira/consultaCNPJ.js',
  './js/carteira/tela.js',
  './js/carteira/formulario.js',
  './js/mapa/tela.js',
  './js/agenda/tela.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll aborta tudo se UM arquivo falhar. Individual é mais tolerante.
      //
      // ⚠️ `cache: 'reload'` não é detalhe: sem ele, o cache.add busca pelo
      //    cache HTTP do navegador e guarda a versão ANTIGA do arquivo. Um
      //    deploy novo ficaria preso na versão velha até o cache expirar.
      .then((cache) => Promise.allSettled(
        CASCA.map((u) => cache.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase nunca é cacheado aqui: os dados têm seu próprio cache, com data
  // visível na tela. Servir resposta velha de API seria mentir para o usuário.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Tiles do mapa: cache-first, são imutáveis e pesados.
  if (url.hostname.endsWith('.tile.openstreetmap.org')) {
    evento.respondWith(
      caches.open(`${VERSAO}-tiles`).then(async (cache) => {
        const guardado = await cache.match(request);
        if (guardado) return guardado;
        try {
          const resposta = await fetch(request);
          if (resposta.ok) cache.put(request, resposta.clone());
          return resposta;
        } catch {
          return new Response('', { status: 504 });
        }
      }),
    );
    return;
  }

  // Código: rede primeiro (pega deploy novo), cache como rede de segurança.
  //
  // 🔴 `cache: 'no-cache'` é obrigatório aqui. Sem ele, este fetch consulta o
  //    cache HTTP do navegador — e como o servidor estático não manda
  //    Cache-Control, o navegador aplica cache heurístico e devolve a versão
  //    ANTIGA. O "rede primeiro" viraria "cache primeiro" sem ninguém notar,
  //    e todo deploy ficaria invisível até o cache expirar sozinho.
  //    'no-cache' revalida com o servidor (aceita 304), então continua barato.
  const requisicao = url.origin === self.location.origin
    ? new Request(request, { cache: 'no-cache' })
    : request;

  evento.respondWith(
    fetch(requisicao)
      .then((resposta) => {
        if (resposta.ok && url.origin === self.location.origin) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(request, copia));
        }
        return resposta;
      })
      .catch(async () => (await caches.match(request))
        ?? (await caches.match('./index.html'))
        ?? new Response('Offline', { status: 503 })),
  );
});
