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
import { pedido } from '../cotacoes/dadosPedido.js';

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
export const recursos = {
  cnpj: true, cotacoes: true, fotografiaCotacao: true, dataTabela: true,
};

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
    if (ordem) {
      consulta = consulta.order(ordem).order(tabela === 'catalogo' ? 'codigo_sigma' : 'id');
    }
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
const COLUNAS_CATALOGO_BASE =
  'codigo_sigma, codigo_fabricante, descricao, valor_unitario_centavos, ipi, '
  + 'st, categoria, grupo, saldo, status_estoque, atualizado_em';

/**
 * Catálogo. `data_tabela` veio na migração 06 — de quando é a PLANILHA, que é
 * diferente de quando sincronizamos. Mesmo plano B das outras tabelas: sem a
 * coluna, o PostgREST recusaria a consulta inteira e o portal ficaria sem
 * catálogo em vez de ficar só sem o aviso de preço velho.
 */
async function buscarCatalogo() {
  try {
    const dados = await buscarTudo(
      'catalogo', `${COLUNAS_CATALOGO_BASE}, data_tabela`, 'descricao');
    recursos.dataTabela = true;
    return dados;
  } catch (erro) {
    if (!/column .* does not exist|data_tabela/i.test(erro.message || '')) throw erro;
    recursos.dataTabela = false;
    console.warn('Coluna data_tabela ausente — rode '
      + 'modelos/supabase/06-data-da-tabela.sql. O portal funciona, mas não '
      + 'avisa quando a tabela de preços está velha.');
    return buscarTudo('catalogo', COLUNAS_CATALOGO_BASE, 'descricao');
  }
}

const COLUNAS_COTACAO_BASE =
  'id, cliente_id, representante_id, numero, nome_cliente, data, situacao, '
  + 'total_produtos_centavos, total_ipi_centavos, total_com_ipi_centavos, '
  + 'quantidade_itens, itens, observacoes, condicoes, atualizado_em';

// `vendedor`, `cliente` e `empresa` vieram na migração 05. Como em clientes,
// o PostgREST recusa a consulta INTEIRA se uma coluna não existe — por isso
// existe a versão sem elas. Sem o plano B, quem não rodou a migração perderia
// o histórico todo em vez de perder só a fotografia do cabeçalho.
const COLUNAS_COTACAO = `${COLUNAS_COTACAO_BASE}, vendedor, cliente, empresa`;

export function normalizarCotacao(c) {
  if (!c) return c;
  const desc = c.total_desconto_centavos ?? c.condicoes?.total_desconto_centavos ?? 0;
  const bruto = c.total_bruto_centavos ?? c.condicoes?.total_bruto_centavos ?? ((c.total_produtos_centavos ?? 0) + desc);
  return {
    ...c,
    total_desconto_centavos: desc,
    total_bruto_centavos: bruto,
  };
}

async function buscarCotacoes() {
  try {
    const dados = await buscarTudo('cotacoes', COLUNAS_COTACAO, 'data');
    recursos.cotacoes = true;
    recursos.fotografiaCotacao = true;
    return dados.map(normalizarCotacao);
  } catch (erro) {
    const mensagem = erro.message || '';

    if (/column .* does not exist|vendedor|cliente|empresa/i.test(mensagem)) {
      recursos.cotacoes = true;
      recursos.fotografiaCotacao = false;
      console.warn('Colunas de fotografia ausentes — rode '
        + 'modelos/supabase/05-historico-cotacoes.sql. O histórico funciona, '
        + 'mas o PDF regerado usa o cadastro atual do cliente.');
      const dados = await buscarTudo('cotacoes', COLUNAS_COTACAO_BASE, 'data');
      return dados.map(normalizarCotacao);
    }

    if (/relation.*cotacoes.*does not exist|table.*cotacoes.*does not exist|could not find.*cotacoes.*in the schema cache/i.test(mensagem)) {
      recursos.cotacoes = false;
      console.warn('Tabela cotacoes ausente — rode modelos/supabase/03-cnpj-e-cotacoes.sql');
      return [];
    }
    throw erro;
  }
}

function ordenarCotacoes(lista) {
  return [...lista].sort((a, b) =>
    String(b.data || '').localeCompare(String(a.data || ''))
    || String(b.criado_em ?? b.atualizado_em ?? '').localeCompare(String(a.criado_em ?? a.atualizado_em ?? '')));
}

function mesclarCotacoes(base = [], extras = []) {
  const mapa = new Map();
  for (const c of base) if (c?.id) mapa.set(c.id, normalizarCotacao(c));
  for (const c of extras) if (c?.id) mapa.set(c.id, normalizarCotacao(c));
  return ordenarCotacoes(Array.from(mapa.values()));
}

/**
 * Junta as cotações locais, a fila offline e (se online) os números já
 * gravados no Supabase, garantindo que códigos recém-gerados não repitam
 * números de outros dispositivos/sessões.
 */
export async function cotacoesParaNumeracao() {
  const itensFila = await pendentes();
  const filaCots = itensFila
    .filter((it) => it.tabela === 'cotacoes' && it.registro)
    .map((it) => it.registro);

  let remotas = [];
  if (estaOnline()) {
    try {
      remotas = await buscarTudo('cotacoes', 'id, numero', 'data');
    } catch {
      remotas = [];
    }
  }

  const mapa = new Map();
  for (const c of estado.cotacoes) if (c?.id) mapa.set(c.id, { id: c.id, numero: c.numero });
  for (const c of remotas) if (c?.id) mapa.set(c.id, { id: c.id, numero: c.numero });
  for (const c of filaCots) if (c?.id) mapa.set(c.id, { id: c.id, numero: c.numero });
  return Array.from(mapa.values());
}

/** Carrega tudo. Se `aoVivo` falhar, cai para o cache sem perder a tela. */
export async function carregar() {
  // 1. cache + fila pendente primeiro — nunca deixa trabalho offline ou recém-salvo sumir na inicialização
  const [catCache, cliCache, visCache, cotCache, itensFila] = await Promise.all([
    recuperar('catalogo'), recuperar('clientes'),
    recuperar('visitas'), recuperar('cotacoes'),
    pendentes(),
  ]);

  const temCache = Boolean(catCache || cliCache || visCache || cotCache || itensFila.length);
  if (temCache) {
    estado.catalogo = catCache?.dados ?? [];
    estado.clientes = cliCache?.dados ?? [];
    estado.visitas = visCache?.dados ?? [];
    const cotacoesCache = cotCache?.dados ?? [];
    const cotacoesFila = itensFila
      .filter((it) => it.tabela === 'cotacoes' && it.registro)
      .map((it) => it.registro);
    estado.cotacoes = mesclarCotacoes(cotacoesCache, cotacoesFila);
    estado.pendentes = itensFila.length;
    estado.atualizadoEm = catCache?.gravadoEm ?? cotCache?.gravadoEm ?? null;
    estado.daCache = true;
    avisar();
  }

  // 2. servidor
  return atualizar();
}

export async function atualizar() {
  const inicioAtualizacao = new Date().toISOString();
  estado.sincronizando = true;
  estado.erro = null;
  avisar();

  try {
    // 1. Aguarda / descarrega fila antes de consultar o servidor
    await sincronizarFila();

    // 2. Busca dados mais recentes do servidor
    const [catalogo, clientes, visitas, cotacoes] = await Promise.all([
      buscarCatalogo(),
      buscarClientes(),
      buscarTudo('visitas',
        'id, cliente_id, representante_id, nome_cliente, data, hora, duracao_minutos, status, objetivo, observacoes, resultado, atualizado_em',
        'data'),
      buscarCotacoes(),
    ]);

    // 3. Mescla com pendências da fila e salvamentos concorrentes feitos durante o refresh
    const itensFila = await pendentes();

    const filaCotacoes = itensFila
      .filter((it) => it.tabela === 'cotacoes' && it.registro)
      .map((it) => it.registro);
    const cotacoesConcorrentes = estado.cotacoes.filter(
      (c) => c?.atualizado_em && String(c.atualizado_em) >= inicioAtualizacao);
    const cotacoesMescladas = mesclarCotacoes(cotacoes, [...cotacoesConcorrentes, ...filaCotacoes]);

    const mapaVisitas = new Map();
    for (const v of visitas) mapaVisitas.set(v.id, v);
    for (const it of itensFila) {
      if (it.tabela === 'visitas' && it.registro) {
        mapaVisitas.set(it.registro.id, it.registro);
      }
    }
    const visitasMescladas = Array.from(mapaVisitas.values());

    const mapaClientes = new Map();
    for (const cli of clientes) mapaClientes.set(cli.id, cli);
    for (const it of itensFila) {
      if (it.tabela === 'clientes' && it.registro) {
        mapaClientes.set(it.registro.id, it.registro);
      }
    }
    const clientesMesclados = Array.from(mapaClientes.values());

    estado.catalogo = catalogo;
    estado.clientes = clientesMesclados;
    estado.visitas = visitasMescladas;
    estado.cotacoes = cotacoesMescladas;
    estado.atualizadoEm = new Date().toISOString();
    estado.daCache = false;

    await Promise.all([
      guardar('catalogo', catalogo),
      guardar('clientes', clientesMesclados),
      guardar('visitas', visitasMescladas),
      guardar('cotacoes', cotacoesMescladas),
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
    const filaRestante = await pendentes();
    if (filaRestante.length) await sincronizarFila();
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
  const agora = new Date().toISOString();
  const norm = normalizarCotacao(cotacao);
  const registro = {
    ...norm,
    criado_em: norm.criado_em || agora,
    atualizado_em: agora,
  };

  const i = estado.cotacoes.findIndex((c) => c.id === registro.id);
  if (i >= 0) estado.cotacoes[i] = { ...estado.cotacoes[i], ...registro };
  else estado.cotacoes.unshift(registro);
  estado.cotacoes = ordenarCotacoes(estado.cotacoes);

  errosSincronizacao.delete(`cotacoes:${registro.id}`);
  await guardar('cotacoes', estado.cotacoes);
  await enfileirar('cotacoes', registro);
  estado.pendentes = (await pendentes()).length;
  avisar();

  const promessa = sincronizarFila();
  if (estaOnline()) {
    let temporizador;
    await Promise.race([
      promessa,
      new Promise((resolve) => { temporizador = setTimeout(resolve, 5000); }),
    ]).finally(() => clearTimeout(temporizador));
  }
  return estado.cotacoes.find((c) => c.id === registro.id) ?? registro;
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
  try { await desenfileirar(`cotacoes:${id}`); } catch { /* segue para exclusão remota */ }
  errosSincronizacao.delete(`cotacoes:${id}`);
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
  return ordenarCotacoes(estado.cotacoes.filter((c) => c.cliente_id === clienteId));
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

const COLUNAS_FOTOGRAFIA_COTACAO = new Set(['vendedor', 'cliente', 'empresa']);

const COLUNAS_VALIDAS_COTACAO = new Set([
  'id', 'equipe_id', 'representante_id', 'cliente_id', 'numero',
  'nome_cliente', 'data', 'situacao', 'total_produtos_centavos',
  'total_ipi_centavos', 'total_com_ipi_centavos', 'quantidade_itens',
  'itens', 'observacoes', 'condicoes', 'vendedor', 'cliente', 'empresa',
  'atualizado_em',
]);

const PRIORIDADE_TABELA = { clientes: 0, visitas: 1, cotacoes: 2 };
const errosSincronizacao = new Map();

function estaOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export async function statusSincronizacaoRegistro(tabela, id) {
  const chave = `${tabela}:${id}`;
  const fila = await pendentes();
  const pendente = fila.some((it) => it.id === chave);
  return { pendente, erro: errosSincronizacao.get(chave) ?? null };
}

function sanitizarParaSupabase(tabela, registro) {
  if (tabela !== 'cotacoes' || !registro) return registro;
  const limpo = {};
  for (const [k, v] of Object.entries(registro)) {
    if (!COLUNAS_VALIDAS_COTACAO.has(k)) continue;
    if (recursos.fotografiaCotacao === false && COLUNAS_FOTOGRAFIA_COTACAO.has(k)) continue;
    limpo[k] = v;
  }
  return limpo;
}

function atualizarNumeroEmRascunho(id, numero) {
  try {
    const bruto = localStorage.getItem('cotacao_rascunho');
    if (!bruto) return;
    const rascunho = JSON.parse(bruto);
    if (rascunho?.cotacaoId === id) {
      localStorage.setItem('cotacao_rascunho', JSON.stringify({ ...rascunho, cotacaoNumero: numero }));
    }
  } catch { /* modo privativo */ }
}

let promessaSincronizacao = null;

/** Esvazia a fila em ordem de dependência. Sanitiza payloads e trata conflitos/esquema. */
export async function sincronizarFila() {
  if (promessaSincronizacao) return promessaSincronizacao;

  promessaSincronizacao = (async () => {
    try {
      for (;;) {
        const fila = (await pendentes()).sort((a, b) =>
          (PRIORIDADE_TABELA[a.tabela] ?? 9) - (PRIORIDADE_TABELA[b.tabela] ?? 9));
        estado.pendentes = fila.length;
        if (!fila.length || !estaOnline()) { avisar(); return; }

        let houveMudanca = false;
        let erroRede = false;

        for (const item of fila) {
          try {
            let payload = sanitizarParaSupabase(item.tabela, item.registro);
            let { error } = await sb.from(item.tabela).upsert(payload);

            // Migração 05 ausente: reenvia sem as colunas de fotografia para não perder o registro
            if (error && item.tabela === 'cotacoes'
                && (error.code === 'PGRST204'
                  || /column .* does not exist|vendedor|cliente|empresa|schema cache/i.test(error.message || ''))) {
              recursos.fotografiaCotacao = false;
              payload = sanitizarParaSupabase(item.tabela, item.registro);
              ({ error } = await sb.from(item.tabela).upsert(payload));
            }

            // Conflito de número único com outro dispositivo (Migração 08)
            if (error && item.tabela === 'cotacoes' && error.code === '23505'
                && /numero/i.test(`${error.message || ''} ${error.details || ''}`)) {
              const lista = await cotacoesParaNumeracao();
              const novoNumero = pedido.gerarNumero(
                [...lista, { id: '__conflito__', numero: item.registro.numero }],
                item.registro.id,
              );
              const atualizado = { ...item.registro, numero: novoNumero, atualizado_em: new Date().toISOString() };
              item.registro = atualizado;

              const idx = estado.cotacoes.findIndex((c) => c.id === atualizado.id);
              if (idx >= 0) estado.cotacoes[idx] = { ...estado.cotacoes[idx], ...atualizado };
              else estado.cotacoes.unshift(atualizado);
              estado.cotacoes = ordenarCotacoes(estado.cotacoes);
              await guardar('cotacoes', estado.cotacoes);
              await enfileirar('cotacoes', atualizado);
              atualizarNumeroEmRascunho(atualizado.id, novoNumero);

              payload = sanitizarParaSupabase(item.tabela, atualizado);
              ({ error } = await sb.from(item.tabela).upsert(payload));
            }

            if (error) {
              console.error(`Erro ao sincronizar ${item.id}:`, error);
              if (ehFalhaDeRede(error)) throw error;
              errosSincronizacao.set(item.id, error.message || error.code || 'Erro no servidor');
              await marcarTentativa(item);
              continue;
            }

            errosSincronizacao.delete(item.id);
            await desenfileirar(item.id);
            houveMudanca = true;
          } catch (erro) {
            errosSincronizacao.set(item.id, erro.message || 'Falha de conexão');
            await marcarTentativa(item);
            console.warn('Sincronização adiada:', erro.message);
            erroRede = true;
            break;
          }
        }

        const restantes = await pendentes();
        estado.pendentes = restantes.length;
        avisar();

        // Se drenamos tudo ou chegou item inédito durante a execução, faz mais uma passada
        const temNovoItem = restantes.some((it) => (it.tentativas || 0) === 0);
        if (erroRede || !restantes.length || (!houveMudanca && !temNovoItem)) break;
      }
    } finally {
      promessaSincronizacao = null;
    }
  })();

  return promessaSincronizacao;
}

window.addEventListener('online', () => sincronizarFila());
