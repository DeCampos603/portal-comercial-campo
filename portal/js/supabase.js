/**
 * Cliente Supabase e sessão.
 *
 * O bundle UMD é carregado por <script> no index.html e expõe
 * `window.supabase`. Aqui envolvemos isso numa API própria, para o resto do
 * portal nunca depender do formato da biblioteca.
 */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,      // sobrevive a fechar o navegador
    autoRefreshToken: true,    // renova sozinho: sem relogin no meio da visita
  },
});

const CHAVE_PERFIL_CACHE = 'portal_perfil_cache';

/** Perfil do representante logado (linha da tabela `representantes`), com cache persistente. */
let perfilAtual = (() => {
  try {
    const salvo = localStorage.getItem(CHAVE_PERFIL_CACHE);
    return salvo ? JSON.parse(salvo) : null;
  } catch {
    return null;
  }
})();

export function perfil() {
  return perfilAtual;
}

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session ?? null;
}

export async function entrar(email, senha) {
  const { error } = await sb.auth.signInWithPassword({
    email: String(email).trim(),
    password: senha,
  });
  if (error) throw traduzirErroLogin(error);
  return carregarPerfil();
}

export async function sair() {
  perfilAtual = null;
  try { localStorage.removeItem(CHAVE_PERFIL_CACHE); } catch {}
  await sb.auth.signOut();
}

/**
 * Busca a linha em `representantes`. Devolve null se a conta existe mas não
 * está na allowlist — que é exatamente o caso de um estranho que criou conta.
 */
export async function carregarPerfil() {
  const { data: sessao } = await sb.auth.getSession();
  if (!sessao.session) {
    perfilAtual = null;
    try { localStorage.removeItem(CHAVE_PERFIL_CACHE); } catch {}
    return null;
  }
  const { data, error } = await sb
    .from('representantes')
    .select('id, nome, email, codigo_sigma, ativo, equipe_id')
    .eq('id', sessao.session.user.id)
    .maybeSingle();

  if (error) {
    // Offline: mantém o perfil que já estava em memória/cache em vez de deslogar.
    console.warn('Não consegui carregar o perfil:', error.message);
    return perfilAtual;
  }
  if (data && data.ativo) {
    perfilAtual = data;
    try { localStorage.setItem(CHAVE_PERFIL_CACHE, JSON.stringify(data)); } catch {}
  } else {
    perfilAtual = null;
    try { localStorage.removeItem(CHAVE_PERFIL_CACHE); } catch {}
  }
  return perfilAtual;
}

function traduzirErroLogin(error) {
  const msg = String(error.message || '');
  if (/invalid login credentials/i.test(msg)) {
    return new Error('E-mail ou senha incorretos.');
  }
  if (/email not confirmed/i.test(msg)) {
    return new Error('Conta ainda não confirmada. Confirme pelo painel do Supabase.');
  }
  if (/failed to fetch|networkerror/i.test(msg)) {
    return new Error('Sem conexão. Verifique a internet e tente de novo.');
  }
  return new Error(msg || 'Não foi possível entrar.');
}

/**
 * Erro de rede/autenticação é modo OFFLINE, não motivo para deslogar.
 *
 * Perder a fila de visitas porque o token não renovou no meio de uma visita
 * seria o pior defeito possível deste portal.
 */
export function ehFalhaDeRede(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return /failed to fetch|networkerror|load failed|timeout|offline/i.test(msg);
}
