/**
 * Depósito local (IndexedDB): cache de leitura + fila de escrita.
 *
 * O representante trabalha no balcão do cliente, muitas vezes sem sinal.
 * Duas garantias:
 *   1. Abrir o portal offline mostra os dados da última sincronização, datados.
 *   2. Agendar offline nunca perde o agendamento — ele fica na fila.
 */

const BANCO = 'portal-comercial';
const VERSAO = 1;
const CACHE = 'cache';        // { chave, dados, gravadoEm }
const FILA = 'fila';          // { id, tabela, registro, tentativas }

let conexao = null;

function abrir() {
  if (conexao) return Promise.resolve(conexao);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'chave' });
      if (!db.objectStoreNames.contains(FILA)) db.createObjectStore(FILA, { keyPath: 'id' });
    };
    req.onsuccess = () => { conexao = req.result; resolve(conexao); };
    req.onerror = () => reject(req.error);
  });
}

function transacao(loja, modo, operacao) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(loja, modo);
    const req = operacao(tx.objectStore(loja));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// ---------------------------------------------------------------- cache

export async function guardar(chave, dados) {
  await transacao(CACHE, 'readwrite', (loja) =>
    loja.put({ chave, dados, gravadoEm: new Date().toISOString() }));
}

/** Devolve { dados, gravadoEm } ou null. */
export async function recuperar(chave) {
  try {
    return (await transacao(CACHE, 'readonly', (loja) => loja.get(chave))) ?? null;
  } catch {
    return null;                 // navegador sem IndexedDB: segue sem cache
  }
}

export async function limparCache() {
  await transacao(CACHE, 'readwrite', (loja) => loja.clear());
}

// ----------------------------------------------------------------- fila

/**
 * Enfileira uma escrita. A chave é o próprio id do registro, então reenviar
 * ou reeditar o mesmo item substitui em vez de acumular duplicata.
 */
export async function enfileirar(tabela, registro) {
  await transacao(FILA, 'readwrite', (loja) =>
    loja.put({ id: `${tabela}:${registro.id}`, tabela, registro, tentativas: 0 }));
}

export async function pendentes() {
  try {
    return (await transacao(FILA, 'readonly', (loja) => loja.getAll())) ?? [];
  } catch {
    return [];
  }
}

export async function desenfileirar(id) {
  await transacao(FILA, 'readwrite', (loja) => loja.delete(id));
}

export async function marcarTentativa(item) {
  await transacao(FILA, 'readwrite', (loja) =>
    loja.put({ ...item, tentativas: (item.tentativas || 0) + 1 }));
}

export async function totalPendente() {
  return (await pendentes()).length;
}
