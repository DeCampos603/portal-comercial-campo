/**
 * Carregamento de dados: Supabase → cache local → tela.
 *
 * Ordem de exibição (nunca deixa a tela em branco sem explicação):
 *   1. mostra o cache imediatamente, com a data
 *   2. busca o Supabase em paralelo
 *   3. chegou → atualiza e regrava o cache
 *   4. falhou → mantém o cache e avisa que está offline
 */

import { sb, ehFalhaDeRede } from '../supabase.js';
import { guardar, recuperar, enfileirar, pendentes, desenfileirar, marcarTentativa } from './deposito.js';

export const estado = {
  catalogo: [],
  clientes: [],
  visitas: [],
  atualizadoEm: null,       // quando os dados em memória foram obtidos
  daCache: false,           // true = ainda não confirmou com o servidor
  sincronizando: false,
  pendentes: 0,
  erro: null,
};

const ouvintes = new Set();
export function aoMudar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function avisar() { ouvintes.forEach((fn) => fn(estado)); }

/**
 * Busca todas as linhas de uma tabela, paginando.
 * O PostgREST devolve no máximo 1000 por requisição — sem paginar, o catálogo
 * de 521 passa, mas quebraria em silêncio quando crescer.
 */
async function buscarTudo(tabela, colunas, ordem) {
  const PAGINA = 1000;
  let inicio = 0;
  const tudo = [];
  for (;;) {
    let consulta = sb.from(tabela).select(colunas).range(inicio, inicio + PAGINA - 1);
    if (ordem) consulta = consulta.order(ordem);
    const { data, error } = await consulta;
    if (error) throw error;
    tudo.push(...data);
    if (data.length < PAGINA) return tudo;
    inicio += PAGINA;
  }
}

/** Carrega tudo. Se `aoVivo` falhar, cai para o cache sem perder a tela. */
export async function carregar() {
  // 1. cache primeiro — tela útil na hora
  const [catCache, cliCache, visCache] = await Promise.all([
    recuperar('catalogo'), recuperar('clientes'), recuperar('visitas'),
  ]);
  if (catCache) {
    estado.catalogo = catCache.dados;
    estado.clientes = cliCache?.dados ?? [];
    estado.visitas = visCache?.dados ?? [];
    estado.atualizadoEm = catCache.gravadoEm;
    estado.daCache = true;
    avisar();
  }

  // 2. servidor
  return atualizar();
}

export async function atualizar() {
  estado.sincronizando = true;
  estado.erro = null;
  avisar();

  try {
    const [catalogo, clientes, visitas] = await Promise.all([
      buscarTudo('catalogo',
        'codigo_sigma, codigo_fabricante, descricao, valor_unitario_centavos, ipi, st, categoria, grupo, saldo, status_estoque, atualizado_em',
        'descricao'),
      buscarTudo('clientes',
        'id, codigo, nome, origem, status, contato, telefone, whatsapp, email, logradouro, bairro, cidade, uf, cep, lat, lng, geo_precisao, grupo_economico, notas, ultima_visita',
        'nome'),
      buscarTudo('visitas',
        'id, cliente_id, representante_id, nome_cliente, data, hora, duracao_minutos, status, objetivo, observacoes, resultado, atualizado_em',
        'data'),
    ]);

    estado.catalogo = catalogo;
    estado.clientes = clientes;
    estado.visitas = visitas;
    estado.atualizadoEm = new Date().toISOString();
    estado.daCache = false;

    await Promise.all([
      guardar('catalogo', catalogo),
      guardar('clientes', clientes),
      guardar('visitas', visitas),
    ]);
  } catch (erro) {
    // Offline com cache é situação normal, não erro para alarmar.
    estado.erro = ehFalhaDeRede(erro)
      ? (estado.catalogo.length ? null : 'Sem conexão e sem dados salvos.')
      : `Falha ao carregar: ${erro.message}`;
    estado.daCache = true;
    console.warn('Carregamento adiado:', erro.message);
  } finally {
    estado.sincronizando = false;
    await sincronizarFila();
    avisar();
  }
  return estado;
}

// ------------------------------------------------------------- escrita

/**
 * Grava local primeiro, atualiza a tela, e só então tenta a rede.
 * A interface NUNCA espera o servidor.
 */
export async function salvarVisita(visita) {
  const registro = { ...visita, atualizado_em: new Date().toISOString() };

  const i = estado.visitas.findIndex((v) => v.id === registro.id);
  if (i >= 0) estado.visitas[i] = { ...estado.visitas[i], ...registro };
  else estado.visitas.push(registro);

  await guardar('visitas', estado.visitas);
  await enfileirar('visitas', registro);
  avisar();

  sincronizarFila();          // sem await: segundo plano
  return registro;
}

export async function salvarCliente(cliente) {
  const registro = { ...cliente };
  const i = estado.clientes.findIndex((c) => c.id === registro.id);
  if (i >= 0) estado.clientes[i] = { ...estado.clientes[i], ...registro };

  await guardar('clientes', estado.clientes);
  await enfileirar('clientes', registro);
  avisar();

  sincronizarFila();
  return registro;
}

export async function excluirVisita(id) {
  estado.visitas = estado.visitas.filter((v) => v.id !== id);
  await guardar('visitas', estado.visitas);
  avisar();
  try {
    await sb.from('visitas').delete().eq('id', id);
  } catch (erro) {
    console.warn('Exclusão adiada:', erro.message);
  }
}

/** Esvazia a fila. Para no primeiro erro — não martela servidor fora do ar. */
export async function sincronizarFila() {
  if (estado.sincronizando) return;
  const fila = await pendentes();
  estado.pendentes = fila.length;
  if (!fila.length || !navigator.onLine) { avisar(); return; }

  for (const item of fila) {
    try {
      const { error } = await sb.from(item.tabela).upsert(item.registro);
      if (error) throw error;
      await desenfileirar(item.id);
    } catch (erro) {
      await marcarTentativa(item);
      console.warn('Sincronização adiada:', erro.message);
      break;
    }
  }

  estado.pendentes = (await pendentes()).length;
  avisar();
}

window.addEventListener('online', () => sincronizarFila());
