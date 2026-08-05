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
  cotacoes: [],
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
 * Colunas do cliente. `cnpj` e `inscricao_estadual` vieram na migração 03 —
 * se ela ainda não foi aplicada, o PostgREST recusa a consulta inteira.
 * Por isso existe a versão sem elas, usada como plano B.
 */
const COLUNAS_CLIENTE_BASE =
  'id, codigo, nome, origem, status, contato, telefone, whatsapp, email, '
  + 'logradouro, bairro, cidade, uf, cep, lat, lng, geo_precisao, '
  + 'grupo_economico, notas, ultima_visita';
const COLUNAS_CLIENTE = `${COLUNAS_CLIENTE_BASE}, cnpj, inscricao_estadual`;

/** Sinaliza à interface o que o banco ainda não tem. */
export const recursos = { cnpj: true, cotacoes: true, fotografiaCotacao: true };

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

/**
 * Clientes, tolerando a migração 03 ainda não aplicada.
 * Sem isso, um banco desatualizado derrubaria o carregamento inteiro —
 * o portal ficaria sem catálogo por causa de uma coluna que falta.
 */
async function buscarClientes() {
  try {
    const dados = await buscarTudo('clientes', COLUNAS_CLIENTE, 'nome');
    recursos.cnpj = true;
    return dados;
  } catch (erro) {
    if (!/column .* does not exist|cnpj/i.test(erro.message || '')) throw erro;
    recursos.cnpj = false;
    console.warn('Coluna cnpj ausente — rode modelos/supabase/03-cnpj-e-cotacoes.sql');
    return buscarTudo('clientes', COLUNAS_CLIENTE_BASE, 'nome');
  }
}

/** Cotações. Tabela nova: se não existir, segue sem histórico. */
const COLUNAS_COTACAO_BASE =
  'id, cliente_id, representante_id, numero, nome_cliente, data, situacao, '
  + 'total_produtos_centavos, total_ipi_centavos, total_com_ipi_centavos, '
  + 'quantidade_itens, itens, observacoes, condicoes, atualizado_em';

// `vendedor`, `cliente` e `empresa` vieram na migração 05. Como em clientes,
// o PostgREST recusa a consulta INTEIRA se uma coluna não existe — por isso
// existe a versão sem elas. Sem o plano B, quem não rodou a migração perderia
// o histórico todo em vez de perder só a fotografia do cabeçalho.
const COLUNAS_COTACAO = `${COLUNAS_COTACAO_BASE}, vendedor, cliente, empresa`;

async function buscarCotacoes() {
  try {
    const dados = await buscarTudo('cotacoes', COLUNAS_COTACAO, 'data');
    recursos.cotacoes = true;
    recursos.fotografiaCotacao = true;
    return dados;
  } catch (erro) {
    const mensagem = erro.message || '';

    if (/column .* does not exist|vendedor|cliente|empresa/i.test(mensagem)) {
      recursos.cotacoes = true;
      recursos.fotografiaCotacao = false;
      console.warn('Colunas de fotografia ausentes — rode '
        + 'modelos/supabase/05-historico-cotacoes.sql. O histórico funciona, '
        + 'mas o PDF regerado usa o cadastro atual do cliente.');
      return buscarTudo('cotacoes', COLUNAS_COTACAO_BASE, 'data');
    }

    if (!/does not exist|relation|schema cache/i.test(mensagem)) throw erro;
    recursos.cotacoes = false;
    console.warn('Tabela cotacoes ausente — rode modelos/supabase/03-cnpj-e-cotacoes.sql');
    return [];
  }
}

/** Carrega tudo. Se `aoVivo` falhar, cai para o cache sem perder a tela. */
export async function carregar() {
  // 1. cache primeiro — tela útil na hora
  const [catCache, cliCache, visCache, cotCache] = await Promise.all([
    recuperar('catalogo'), recuperar('clientes'),
    recuperar('visitas'), recuperar('cotacoes'),
  ]);
  if (catCache) {
    estado.catalogo = catCache.dados;
    estado.clientes = cliCache?.dados ?? [];
    estado.visitas = visCache?.dados ?? [];
    estado.cotacoes = cotCache?.dados ?? [];
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
    const [catalogo, clientes, visitas, cotacoes] = await Promise.all([
      buscarTudo('catalogo',
        'codigo_sigma, codigo_fabricante, descricao, valor_unitario_centavos, ipi, st, categoria, grupo, saldo, status_estoque, atualizado_em',
        'descricao'),
      buscarClientes(),
      buscarTudo('visitas',
        'id, cliente_id, representante_id, nome_cliente, data, hora, duracao_minutos, status, objetivo, observacoes, resultado, atualizado_em',
        'data'),
      buscarCotacoes(),
    ]);

    estado.catalogo = catalogo;
    estado.clientes = clientes;
    estado.visitas = visitas;
    estado.cotacoes = cotacoes;
    estado.atualizadoEm = new Date().toISOString();
    estado.daCache = false;

    await Promise.all([
      guardar('catalogo', catalogo),
      guardar('clientes', clientes),
      guardar('visitas', visitas),
      guardar('cotacoes', cotacoes),
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

/**
 * Grava a cotação no histórico do cliente.
 *
 * Os itens vão como JSON — é uma FOTOGRAFIA do momento. O preço muda toda
 * semana; o histórico precisa preservar o que foi realmente cotado, não o
 * preço de hoje.
 */
export async function salvarCotacao(cotacao) {
  if (!recursos.cotacoes) {
    console.warn('Histórico indisponível: tabela cotacoes ainda não existe.');
    return null;
  }
  const registro = { ...cotacao, atualizado_em: new Date().toISOString() };

  const i = estado.cotacoes.findIndex((c) => c.id === registro.id);
  if (i >= 0) estado.cotacoes[i] = { ...estado.cotacoes[i], ...registro };
  else estado.cotacoes.unshift(registro);

  await guardar('cotacoes', estado.cotacoes);
  await enfileirar('cotacoes', registro);
  avisar();

  sincronizarFila();
  return registro;
}

/**
 * Apaga uma cotação do histórico.
 *
 * Vai direto ao servidor em vez de passar pela fila: excluir é raro e
 * intencional, e uma exclusão que fica pendente na fila reapareceria na tela
 * como se ainda existisse. Se falhar, o registro volta para a lista — melhor
 * mostrar que continua lá do que fingir que sumiu.
 */
export async function excluirCotacao(id) {
  const antes = estado.cotacoes;
  estado.cotacoes = estado.cotacoes.filter((c) => c.id !== id);
  await guardar('cotacoes', estado.cotacoes);
  avisar();

  const { error } = await sb.from('cotacoes').delete().eq('id', id);
  if (error) {
    estado.cotacoes = antes;
    await guardar('cotacoes', estado.cotacoes);
    avisar();
    throw error;
  }
}

/** Cotações de um cliente, da mais recente para a mais antiga. */
export function cotacoesDoCliente(clienteId) {
  return estado.cotacoes
    .filter((c) => c.cliente_id === clienteId)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
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
