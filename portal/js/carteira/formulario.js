/**
 * Formulário de cliente — usado para criar e para editar.
 *
 * Fica separado da tela porque é chamado de dois lugares: da ficha na
 * carteira e do botão "novo cliente" na aba de cotações.
 */

import { estado, salvarCliente } from '../nucleo/dados.js';
import { abrirPainel, esc, avisar } from '../nucleo/ui.js';
import { consultarCNPJ } from './consultaCNPJ.js';
import { perfil } from '../supabase.js';

/** Guarda só os dígitos — comparação e busca ficam previsíveis. */
export function digitosCNPJ(bruto) {
  return String(bruto ?? '').replace(/\D/g, '');
}

/** 12345678000199 → 12.345.678/0001-99 */
export function formatarCNPJ(bruto) {
  const d = digitosCNPJ(bruto);
  if (d.length !== 14) return bruto || '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Valida o CNPJ pelos dígitos verificadores.
 *
 * Vale a pena: um CNPJ errado no pedido vira nota fiscal recusada. Melhor
 * avisar na hora da digitação do que descobrir na emissão.
 */
export function cnpjValido(bruto) {
  const d = digitosCNPJ(bruto);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;

  const digito = (fatia, pesos) => {
    const soma = pesos.reduce((acc, peso, i) => acc + Number(fatia[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];

  return digito(d, p1) === Number(d[12]) && digito(d, p2) === Number(d[13]);
}

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

/**
 * Abre o formulário.
 * @param {object|null} cliente  null = novo
 * @param {(cliente) => void} aoSalvar
 */
export function abrirFormularioCliente(cliente = null, aoSalvar = null) {
  const novo = !cliente;
  const c = cliente ?? {};

  abrirPainel(novo ? 'Novo cliente' : `Editar — ${c.nome}`, `
    <div class="grade">
      <div>
        <label class="rotulo" for="cli-nome">Razão social *</label>
        <input class="campo" id="cli-nome" value="${esc(c.nome || '')}" required
               placeholder="Nome da empresa">
      </div>

      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="cli-cnpj">CNPJ</label>
          <div class="linha" style="gap:6px">
            <input class="campo" id="cli-cnpj" inputmode="numeric" style="flex:1"
                   value="${esc(formatarCNPJ(c.cnpj))}" placeholder="00.000.000/0000-00">
            <button class="btn" id="cli-consultar" type="button"
                    title="Buscar dados na Receita Federal">🔎</button>
          </div>
          <p class="minusculo" id="cli-cnpj-aviso" style="margin:4px 0 0"></p>
        </div>
        <div>
          <label class="rotulo" for="cli-ie">Inscrição Estadual</label>
          <input class="campo" id="cli-ie" value="${esc(c.inscricao_estadual || '')}"
                 placeholder="Isento, se for o caso">
        </div>
      </div>

      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="cli-codigo">Código Sigma *</label>
          <input class="campo" id="cli-codigo" value="${esc(c.codigo || '')}" required
                 placeholder="Ex.: 21152" ${novo ? '' : 'readonly'}>
          ${novo ? '' : '<p class="minusculo suave" style="margin:4px 0 0">Não editável — identifica o cliente.</p>'}
        </div>
        <div>
          <label class="rotulo" for="cli-status">Situação</label>
          <select class="campo" id="cli-status">
            ${['Sem Título', 'Com Título', 'Atrasado'].map((s) =>
              `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>

      <div>
        <label class="rotulo" for="cli-contato">Contato (nome da pessoa)</label>
        <input class="campo" id="cli-contato" value="${esc(c.contato || '')}"
               placeholder="Com quem você fala nesse cliente?">
      </div>

      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="cli-telefone">Telefone</label>
          <input class="campo" id="cli-telefone" inputmode="tel"
                 value="${esc(c.telefone || '')}" placeholder="(21) 00000-0000">
        </div>
        <div>
          <label class="rotulo" for="cli-email">E-mail</label>
          <input class="campo" id="cli-email" type="email" value="${esc(c.email || '')}">
        </div>
      </div>

      <div>
        <label class="rotulo" for="cli-logradouro">Endereço</label>
        <input class="campo" id="cli-logradouro" value="${esc(c.logradouro || '')}"
               placeholder="Rua, avenida…">
      </div>

      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="cli-bairro">Bairro</label>
          <input class="campo" id="cli-bairro" value="${esc(c.bairro || '')}">
        </div>
        <div>
          <label class="rotulo" for="cli-cep">CEP</label>
          <input class="campo" id="cli-cep" inputmode="numeric"
                 value="${esc(c.cep || '')}" placeholder="00000-000">
        </div>
      </div>

      <div class="grade grade--2">
        <div>
          <label class="rotulo" for="cli-cidade">Cidade</label>
          <input class="campo" id="cli-cidade" value="${esc(c.cidade || '')}">
        </div>
        <div>
          <label class="rotulo" for="cli-uf">UF</label>
          <select class="campo" id="cli-uf">
            ${UFS.map((u) => `<option ${(c.uf || 'RJ') === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </div>
      </div>

      <div>
        <label class="rotulo" for="cli-notas">Notas</label>
        <textarea class="campo" id="cli-notas" rows="3"
          placeholder="O que precisa lembrar na próxima visita?">${esc(c.notas || '')}</textarea>
      </div>

      <div id="cli-erro" class="faixa faixa--risco oculto" role="alert"></div>
      <button class="btn btn--primario" id="cli-salvar">
        ${novo ? 'Cadastrar cliente' : 'Salvar alterações'}
      </button>

      ${novo ? `<p class="minusculo suave" style="margin:0">
        O cliente entra sem coordenada — não aparece no mapa até ser
        geocodificado. Preencher o CEP ajuda quando isso for feito.
      </p>` : ''}
    </div>`);

  // Feedback do CNPJ enquanto digita: formata e valida sem travar a digitação.
  const campoCNPJ = document.getElementById('cli-cnpj');
  const avisoCNPJ = document.getElementById('cli-cnpj-aviso');
  campoCNPJ.addEventListener('input', () => {
    const d = digitosCNPJ(campoCNPJ.value);
    if (d.length === 14) {
      campoCNPJ.value = formatarCNPJ(d);
      const ok = cnpjValido(d);
      avisoCNPJ.textContent = ok ? '✅ CNPJ válido' : '⚠️ Dígito verificador não confere';
      avisoCNPJ.style.color = ok ? 'var(--cor-ok)' : 'var(--cor-atencao)';
    } else {
      avisoCNPJ.textContent = d ? `${d.length}/14 dígitos` : '';
      avisoCNPJ.style.color = 'var(--cor-texto-suave)';
    }
  });

  // ---- Consulta na base pública da Receita (BrasilAPI)
  document.getElementById('cli-consultar').addEventListener('click', async () => {
    const botao = document.getElementById('cli-consultar');
    const aviso = document.getElementById('cli-cnpj-aviso');
    botao.disabled = true;
    botao.textContent = '⏳';
    aviso.textContent = 'Consultando a Receita…';
    aviso.style.color = 'var(--cor-texto-suave)';

    try {
      const d = await consultarCNPJ(campoCNPJ.value);

      // Só preenche campo VAZIO — o que o representante digitou vale mais
      // que o cadastro da Receita, que traz o endereço da inscrição e nem
      // sempre é onde a mercadoria é entregue.
      const preencher = (id, valor) => {
        const campo = document.getElementById(id);
        if (campo && valor && !campo.value.trim()) {
          campo.value = valor;
          campo.style.background = 'var(--cor-ok-fundo)';
          return 1;
        }
        return 0;
      };

      let n = 0;
      n += preencher('cli-nome', d.razaoSocial);
      n += preencher('cli-logradouro', d.logradouro);
      n += preencher('cli-bairro', d.bairro);
      n += preencher('cli-cidade', d.cidade);
      n += preencher('cli-cep', d.cep);
      n += preencher('cli-telefone', d.telefone);
      n += preencher('cli-email', d.email);
      if (d.uf) {
        const uf = document.getElementById('cli-uf');
        if (uf) uf.value = d.uf;
      }

      campoCNPJ.value = formatarCNPJ(d.cnpj);
      aviso.innerHTML = d.ativa
        ? `✅ ${esc(d.razaoSocial)} — ${n} campo(s) preenchido(s)`
        : `⚠️ Situação na Receita: <strong>${esc(d.situacao)}</strong> — `
          + 'empresa não ativa não emite nota.';
      aviso.style.color = d.ativa ? 'var(--cor-ok)' : 'var(--cor-risco)';

      if (!n) {
        aviso.innerHTML += ' <span class="suave">(campos já preenchidos foram mantidos)</span>';
      }
    } catch (erro) {
      aviso.textContent = `⚠️ ${erro.message}`;
      aviso.style.color = 'var(--cor-atencao)';
    } finally {
      botao.disabled = false;
      botao.textContent = '🔎';
    }
  });

  document.getElementById('cli-salvar').addEventListener('click', async () => {
    const valor = (id) => document.getElementById(id).value.trim();
    const erro = document.getElementById('cli-erro');
    const falhar = (msg) => {
      erro.textContent = msg;
      erro.classList.remove('oculto');
    };

    const nome = valor('cli-nome');
    const codigo = valor('cli-codigo');
    if (!nome) return falhar('A razão social é obrigatória.');
    if (!codigo) return falhar('O código Sigma é obrigatório.');

    // Código duplicado quebraria a chave única (equipe_id, codigo) só na
    // sincronização — melhor barrar aqui, com mensagem clara.
    if (novo && estado.clientes.some((x) => String(x.codigo) === codigo)) {
      return falhar(`Já existe cliente com o código ${codigo}.`);
    }

    const cnpj = digitosCNPJ(valor('cli-cnpj'));
    if (cnpj && !cnpjValido(cnpj)
        && !confirm('O CNPJ digitado parece inválido.\n\nSalvar assim mesmo?')) {
      return undefined;
    }

    const telefone = valor('cli-telefone');
    const registro = {
      id: novo ? crypto.randomUUID() : c.id,
      equipe_id: perfil()?.equipe_id,
      representante_id: perfil()?.id,
      codigo,
      nome,
      origem: c.origem ?? 'recuperacao',   // cliente novo já nasce em trabalho ativo
      status: valor('cli-status'),
      cnpj: cnpj || null,
      inscricao_estadual: valor('cli-ie') || null,
      contato: valor('cli-contato') || null,
      telefone: telefone || null,
      whatsapp: telefone ? `+55${telefone.replace(/\D/g, '')}` : null,
      email: valor('cli-email').toLowerCase() || null,
      logradouro: valor('cli-logradouro') || null,
      bairro: valor('cli-bairro') || null,
      cidade: valor('cli-cidade') || null,
      uf: valor('cli-uf') || null,
      cep: valor('cli-cep') || null,
      notas: valor('cli-notas') || null,
    };

    if (novo) estado.clientes.push(registro);
    await salvarCliente(registro);

    document.querySelector('.painel')?.remove();
    avisar(novo ? 'Cliente cadastrado.' : 'Cliente atualizado.', 'info');
    aoSalvar?.(registro);
    return undefined;
  });
}
