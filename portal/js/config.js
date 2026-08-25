/**
 * Configuração do portal.
 *
 * ⚠️ Só valores PÚBLICOS aqui. Este arquivo vai para o navegador de quem
 *    abrir o site — não existe segredo em site estático.
 *
 * A chave publishable é pública POR DESIGN: ela só enxerga o que as políticas
 * de RLS do banco permitirem. Quem protege os dados é o RLS, não o sigilo
 * desta chave.
 *
 * 🔴 A chave `service_role` (secret) NUNCA entra aqui. Ela ignora o RLS por
 *    completo e vive apenas no .env local e nos GitHub Secrets.
 */

export const SUPABASE_URL = 'https://jzqsyityeoqnvuznboto.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_l8du_r66HkU-w8fNZThQnw_z8Frm4uw';

/** Limiares do semáforo de estoque — espelham a coluna gerada no Postgres. */
export const SALDO_SEM_ESTOQUE = 6;
export const SALDO_BAIXO = 200;

/** Avisa que a tabela de preços pode estar velha depois de tantos dias. */
export const DIAS_ATE_TABELA_VELHA = 7;

/** Centro do mapa (Rio de Janeiro) e zoom inicial. */
export const MAPA_CENTRO = [-22.9068, -43.1729];
export const MAPA_ZOOM = 10;

/**
 * Disparo de WhatsApp em massa — DESLIGADO por enquanto.
 *
 * A aba "Disparos" some da navegação e o módulo nem é carregado. Nada foi
 * apagado: `js/disparador/tela.js` continua no lugar e volta trocando isto
 * para `true`.
 *
 * Além do pedido do usuário, há razões para manter desligado até a decisão
 * ser consciente:
 *
 * · O envio depende do motor local (`motor-whatsapp`, porta 8080). Com ele
 *   fora do ar, o botão falha na cara do representante sem explicação útil.
 * · Envio em massa a partir de conta pessoal é o caminho mais curto para o
 *   WhatsApp bloquear o número — que é o mesmo número usado para atender
 *   cliente todo dia.
 * · Mensagem comercial não solicitada para 378 clientes é assunto de LGPD:
 *   exige base legal e caminho de descadastro, que hoje não existem.
 */
export const DISPARADOR_HABILITADO = false;
