/**
 * Dinheiro em centavos inteiros.
 *
 * Regra do projeto: nenhum cálculo monetário em ponto flutuante. A planilha
 * de origem tem `0.052000000000000005` como alíquota de IPI — esse tipo de
 * ruído nunca pode chegar à tela nem ao total de um pedido.
 */

const FORMATADOR_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const FORMATADOR_NUMERO = new Intl.NumberFormat('pt-BR');

/** Centavos (inteiro) → "R$ 1.234,56". Ausência vira travessão, nunca R$ 0,00. */
export function formatarBRL(centavos) {
  if (centavos === null || centavos === undefined || Number.isNaN(centavos)) return '—';
  return FORMATADOR_BRL.format(centavos / 100);
}

/** Número inteiro com separador de milhar. */
export function formatarNumero(valor) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return FORMATADOR_NUMERO.format(valor);
}

/** Decimal (0.052) → "5,2%". */
export function formatarPercentual(decimal, casas = 2) {
  if (decimal === null || decimal === undefined || Number.isNaN(decimal)) return '—';
  return `${(decimal * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })}%`;
}

/** "1.234,56" ou "1234.56" → 123456 centavos. Devolve null se não for número. */
export function paraCentavos(bruto) {
  if (bruto === null || bruto === undefined || String(bruto).trim() === '') return null;
  const texto = String(bruto).trim();
  if (texto.startsWith('#')) return null;           // #N/A, #REF!
  let limpo = texto.replace(/[R$\s ]/g, '');
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
  const numero = Number(limpo);
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

/**
 * "09:00:00" → "09:00".
 * O Postgres devolve `time` com segundos; a agenda nunca precisa deles.
 */
export function formatarHora(hora) {
  if (!hora) return '--:--';
  return String(hora).slice(0, 5);
}

/** Data ISO → "27/07/2026". */
export function formatarData(iso) {
  if (!iso) return '—';
  const data = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleDateString('pt-BR');
}

/** Data ISO → "27/07 às 14:32". */
export function formatarDataHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ` +
         `${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Dias inteiros entre uma data e hoje. null se a data não existir. */
export function diasDesde(iso) {
  if (!iso) return null;
  const data = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(data.getTime())) return null;
  return Math.floor((Date.now() - data.getTime()) / 86400000);
}

/** Data de hoje no formato AAAA-MM-DD, no fuso local. */
export function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
