/**
 * Consulta de CNPJ na base pública da Receita Federal, via BrasilAPI.
 *
 * Por que BrasilAPI: é gratuita, sem cadastro nem chave, e libera CORS —
 * dá para chamar direto do navegador. Alternativas como a ReceitaWS
 * limitam requisições por minuto e exigem token para uso sério.
 *
 * ⚠️ É a base CADASTRAL. Traz razão social e endereço da inscrição, que
 *    nem sempre é onde a mercadoria é entregue. Por isso o resultado é
 *    APRESENTADO para o usuário conferir, campo a campo, em vez de
 *    sobrescrever o cadastro automaticamente.
 */

const URL_BASE = 'https://brasilapi.com.br/api/cnpj/v1';

/** Cache por sessão: consultar o mesmo CNPJ duas vezes é desperdício. */
const cache = new Map();

/**
 * @param {string} cnpj  com ou sem pontuação
 * @returns {Promise<object>} dados normalizados
 * @throws {Error} com mensagem pronta para exibir
 */
export async function consultarCNPJ(cnpj) {
  const digitos = String(cnpj).replace(/\D/g, '');
  if (digitos.length !== 14) {
    throw new Error('O CNPJ precisa ter 14 dígitos.');
  }
  if (cache.has(digitos)) return cache.get(digitos);

  let resposta;
  try {
    resposta = await fetch(`${URL_BASE}/${digitos}`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Sem conexão para consultar a Receita.');
  }

  if (resposta.status === 404) {
    throw new Error('CNPJ não encontrado na base da Receita.');
  }
  if (resposta.status === 429) {
    throw new Error('Muitas consultas seguidas. Aguarde um instante.');
  }
  if (!resposta.ok) {
    throw new Error(`A consulta falhou (${resposta.status}).`);
  }

  const bruto = await resposta.json();
  const dados = normalizar(bruto);
  cache.set(digitos, dados);
  return dados;
}

/** Traduz o retorno da API para os campos do nosso cadastro. */
function normalizar(d) {
  // A API devolve DDD e número colados: "2121660000".
  const fone = String(d.ddd_telefone_1 || '').replace(/\D/g, '');
  let telefone = null;
  if (fone.length === 11) telefone = `(${fone.slice(0, 2)}) ${fone.slice(2, 7)}-${fone.slice(7)}`;
  else if (fone.length === 10) telefone = `(${fone.slice(0, 2)}) ${fone.slice(2, 6)}-${fone.slice(6)}`;

  const cep = String(d.cep || '').replace(/\D/g, '');

  // O logradouro vem sem o tipo em alguns registros e o número é campo à
  // parte — a carteira guarda tudo numa string só.
  const logradouro = [d.descricao_tipo_de_logradouro, d.logradouro]
    .filter(Boolean).join(' ').trim();

  return {
    cnpj: d.cnpj || '',
    razaoSocial: (d.razao_social || '').trim(),
    nomeFantasia: (d.nome_fantasia || '').trim(),
    logradouro: [logradouro, d.numero].filter(Boolean).join(', '),
    complemento: (d.complemento || '').trim(),
    bairro: (d.bairro || '').trim(),
    cidade: (d.municipio || '').trim(),
    uf: (d.uf || '').trim(),
    cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '',
    telefone,
    email: (d.email || '').toLowerCase().trim() || null,
    situacao: (d.descricao_situacao_cadastral || '').trim(),
    // Situação diferente de ATIVA é sinal de alerta comercial: empresa
    // baixada ou suspensa não emite nota.
    ativa: /ativa/i.test(d.descricao_situacao_cadastral || ''),
    abertura: d.data_inicio_atividade || null,
    atividade: (d.cnae_fiscal_descricao || '').trim(),
    porte: (d.porte || '').trim(),
  };
}

/** Título de exibição: prioriza o nome fantasia, que é como o cliente é conhecido. */
export function nomePreferido(dados) {
  return dados.nomeFantasia || dados.razaoSocial;
}
