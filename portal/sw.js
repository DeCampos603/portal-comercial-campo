/**
 * Service Worker — casca offline.
 *
 * Guarda apenas o CÓDIGO (HTML, CSS, JS, Leaflet). Os dados de negócio ficam
 * no IndexedDB, gerenciados por nucleo/deposito.js — misturar os dois faria
 * o cache de dados expirar junto com um deploy de código.
 *
 * ⚠️ Caminhos relativos: o GitHub Pages serve em subdiretório.
 */

const VERSAO = 'portal-v3';

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
  './js/carteira/tela.js',
  './js/carteira/formulario.js',
  './js/mapa/tela.js',
  './js/agenda/tela.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll aborta tudo se UM arquivo falhar. Individual é mais tolerante.
      .then((cache) => Promise.allSettled(CASCA.map((u) => cache.add(u))))
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
  evento.respondWith(
    fetch(request)
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
