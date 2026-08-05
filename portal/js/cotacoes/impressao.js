/**
 * Emissão da folha do pedido — o caminho ÚNICO até `window.print()`.
 *
 * Existe porque duas telas imprimem o mesmo documento: a cotação em edição e
 * o histórico regerando um PDF antigo. Cada uma com a sua cópia dos cuidados
 * abaixo significaria consertar um bug e deixar o outro de pé.
 *
 * São dois cuidados, ambos descobertos no papel e não na tela:
 *
 * 1. A folha mora no `<body>`, fora do `#app`. Dentro da aba, qualquer
 *    redesenho a recriava vazia — e redesenho acontece sozinho, quando o
 *    histórico grava e quando a fila de sincronização responde.
 *
 * 2. `window.print()` fotografa a página no instante em que é chamado. As
 *    logos são base64, mas base64 evita a REDE, não a DECODIFICAÇÃO. Medido:
 *    no tick da atribuição, `complete=false naturalWidth=0`; no tick seguinte,
 *    `complete=true naturalWidth=300`. Imprimir sem esperar produzia um PDF
 *    com o texto inteiro e nenhuma imagem.
 */

/** A folha, pendurada no `<body>` e criada uma vez só. */
export function areaImpressao() {
  let area = document.getElementById('area-impressao');
  if (!area) {
    area = document.createElement('div');
    area.id = 'area-impressao';
    area.className = 'impressao-so';
    document.body.appendChild(area);
  }
  return area;
}

/**
 * Espera as imagens ficarem prontas.
 *
 * O tempo limite não é detalhe: uma imagem quebrada nunca pode impedir a
 * emissão de um pedido. Melhor sair sem logo do que não sair.
 */
export function esperarImagens(raiz, limiteMs = 3000) {
  const pendentes = [...raiz.querySelectorAll('img')].filter((img) => !img.complete);
  if (!pendentes.length) return Promise.resolve();

  return Promise.race([
    Promise.all(pendentes.map((img) => new Promise((pronto) => {
      img.addEventListener('load', pronto, { once: true });
      img.addEventListener('error', pronto, { once: true });
    }))),
    new Promise((pronto) => { setTimeout(pronto, limiteMs); }),
  ]);
}

/** Monta o HTML na folha, espera o que precisa ser esperado, e imprime. */
export async function imprimirHTML(html) {
  const area = areaImpressao();
  area.innerHTML = html;
  await esperarImagens(area);
  window.print();
}
