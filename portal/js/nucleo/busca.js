/**
 * Índice de busca em memória.
 *
 * 521 itens e 328 clientes cabem folgado na memória. O custo real é
 * normalizar acento e caixa — então isso é feito UMA vez, na montagem do
 * índice, e não a cada tecla.
 */

/** Remove acento, sobe para maiúscula, colapsa espaço. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Monta um índice pesquisável.
 * @param {Array} registros
 * @param {(r) => string[]} extrairCampos  campos que entram na busca
 */
export function criarIndice(registros, extrairCampos) {
  return registros.map((registro) => {
    const campos = extrairCampos(registro).filter(Boolean);
    return {
      registro,
      // Campo 0 é o "código": casamento exato nele vale mais que o resto.
      chave: normalizar(campos[0]),
      texto: normalizar(campos.join(' ')),
    };
  });
}

/**
 * Busca por relevância: código exato > código começa com > contém.
 * Vazio devolve os primeiros `limite` registros, não a lista toda.
 */
export function buscar(indice, termo, limite = 50) {
  const alvo = normalizar(termo);
  if (!alvo) return indice.slice(0, limite).map((i) => i.registro);

  // Cada palavra precisa aparecer — permite "guarnicao samsung" em qualquer ordem.
  const palavras = alvo.split(' ');
  const achados = [];

  for (const item of indice) {
    if (!palavras.every((p) => item.texto.includes(p))) continue;

    let peso;
    if (item.chave === alvo) peso = 0;
    else if (item.chave.startsWith(alvo)) peso = 1;
    else if (item.chave.includes(alvo)) peso = 2;
    else if (item.texto.startsWith(alvo)) peso = 3;
    else peso = 4;

    achados.push({ peso, registro: item.registro });
    // Só corta depois de juntar bastante, senão o corte precede a ordenação.
    if (achados.length > limite * 8) break;
  }

  achados.sort((a, b) => a.peso - b.peso);
  return achados.slice(0, limite).map((a) => a.registro);
}

/** Agenda uma função para rodar após `ms` sem novas chamadas. */
export function comAtraso(fn, ms = 120) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
