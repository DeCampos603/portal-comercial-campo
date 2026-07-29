/**
 * Dias úteis e feriados nacionais.
 *
 * Calculados localmente, não consultados numa API: a validade da cotação
 * precisa sair certa mesmo com o representante sem sinal, no balcão do
 * cliente. Feriado nacional é regra fixa — não vale trocar previsibilidade
 * por uma chamada de rede.
 *
 * Cobre os feriados NACIONAIS. Feriado municipal (São Jorge no Rio, por
 * exemplo) não entra — se virar problema, é o ponto a acrescentar.
 */

/**
 * Domingo de Páscoa pelo algoritmo de Gauss/Meeus.
 * Ancora Carnaval, Sexta-feira Santa e Corpus Christi.
 */
function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const cacheFeriados = new Map();

/** Set de 'AAAA-MM-DD' com os feriados nacionais do ano. */
export function feriadosNacionais(ano) {
  if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);

  const iso = (d) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const somar = (base, dias) => {
    const d = new Date(base);
    d.setDate(d.getDate() + dias);
    return d;
  };

  const pascoa = domingoDePascoa(ano);
  const datas = new Set([
    `${ano}-01-01`,   // Confraternização Universal
    `${ano}-04-21`,   // Tiradentes
    `${ano}-05-01`,   // Dia do Trabalho
    `${ano}-09-07`,   // Independência
    `${ano}-10-12`,   // Nossa Senhora Aparecida
    `${ano}-11-02`,   // Finados
    `${ano}-11-15`,   // Proclamação da República
    `${ano}-11-20`,   // Consciência Negra (nacional desde 2024)
    `${ano}-12-25`,   // Natal
    iso(somar(pascoa, -48)),   // Carnaval (segunda)
    iso(somar(pascoa, -47)),   // Carnaval (terça)
    iso(somar(pascoa, -2)),    // Sexta-feira Santa
    iso(somar(pascoa, 60)),    // Corpus Christi
  ]);

  cacheFeriados.set(ano, datas);
  return datas;
}

function ehDiaUtil(data) {
  const diaDaSemana = data.getDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) return false;   // domingo/sábado

  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return !feriadosNacionais(data.getFullYear()).has(local.toISOString().slice(0, 10));
}

/**
 * Soma dias ÚTEIS a uma data.
 * @param {number} dias
 * @param {Date|string} [inicio]  padrão: hoje
 * @returns {Date}
 */
export function somarDiasUteis(dias, inicio = new Date()) {
  const data = typeof inicio === 'string'
    ? new Date(`${inicio}T12:00`)
    : new Date(inicio);

  let restantes = dias;
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    if (ehDiaUtil(data)) restantes -= 1;
  }
  return data;
}

/** Data em AAAA-MM-DD, no fuso local. */
export function paraISO(data) {
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Validade da cotação: 7 dias úteis a partir de hoje.
 *
 * Devolve a data E o texto para o PDF — o cliente precisa ver a data
 * concreta, não "7 dias" e ficar contando.
 */
export function validadeCotacao(diasUteis = 7, inicio = new Date()) {
  const limite = somarDiasUteis(diasUteis, inicio);
  return {
    data: limite,
    iso: paraISO(limite),
    texto: `${diasUteis} dias úteis — até ${limite.toLocaleDateString('pt-BR')}`,
  };
}
