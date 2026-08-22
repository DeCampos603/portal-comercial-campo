import { estado } from '../nucleo/dados.js';
import { esc, vazio, avisar } from '../nucleo/ui.js';

export function montarDisparador(alvo) {
  desenhar(alvo);
}

function desenhar(alvo) {
  // Puxar clientes com telefone da base inicialmente
  let clientesAtuais = (estado.clientes || []).filter(c => c.telefone && c.telefone.trim().length > 5);

  alvo.innerHTML = `
    <div class="cartao" style="margin-bottom: 16px;">
      <div class="cartao__cabecalho">
        <h2>Disparador de WhatsApp</h2>
      </div>
      <div class="cartao__corpo grade" style="padding: 16px;">
        <div style="flex: 1; min-width: 300px;">
          <label class="rotulo" for="disp-mensagem">Mensagem</label>
          <textarea class="campo" id="disp-mensagem" rows="6" placeholder="Olá {nome}, temos uma novidade..."></textarea>
          <p class="pequeno suave" style="margin-top: 4px;">Use <strong>{nome}</strong> para inserir o nome do contato.</p>
          
          <label class="rotulo" for="disp-anexo" style="margin-top: 12px;">Anexar Mídia (Opcional)</label>
          <input class="campo" type="file" id="disp-anexo" accept="image/*,application/pdf">
          
          <div style="margin-top: 24px; padding: 12px; border-radius: 4px; border: 1px solid var(--cor-borda);">
            <div class="forte">Status do Envio</div>
            <div class="linha" style="margin-top: 8px;">
              <progress id="disp-progresso" value="0" max="100" style="flex: 1; height: 16px;"></progress>
              <span id="disp-status-texto" class="pequeno suave" style="margin-left: 12px; width: 60px; text-align: right;">0%</span>
            </div>
            <div id="disp-log" class="pequeno" style="margin-top: 8px; height: 100px; overflow-y: auto; color: var(--cor-suave);">
              Aguardando início...
            </div>
          </div>
          
          <button class="btn btn--primario" id="disp-btn-enviar" style="width: 100%; margin-top: 16px;">
            Iniciar Disparo
          </button>
        </div>
        
        <div style="flex: 1; min-width: 300px; display: flex; flex-direction: column;">
          <div class="linha">
            <h3 style="flex: 1; margin: 0;">Contatos</h3>
            <button class="btn btn--secundario btn--pequeno" id="disp-importar-wpp" style="margin-right: 8px;">📲 Puxar do WhatsApp</button>
            <button class="btn btn--fantasma btn--pequeno" id="disp-selecionar-todos">Todos</button>
            <button class="btn btn--fantasma btn--pequeno" id="disp-desmarcar-todos">Nenhum</button>
          </div>
          <p class="minusculo suave" style="margin-bottom: 8px;">Selecione os contatos que receberão o disparo.</p>
          
          <div id="disp-lista-clientes" class="rolagem" style="flex: 1; max-height: 400px; border: 1px solid var(--cor-borda); border-radius: 4px; padding: 8px;">
          </div>
        </div>
      </div>
    </div>
    
    <div class="cartao" style="margin-top: 16px;">
      <div class="cartao__corpo" style="padding: 16px;">
        <h3>Conexão com Motor Local</h3>
        <p class="pequeno suave">Certifique-se de que o MotorWhatsApp.exe está aberto e conectado.</p>
        <div class="grade" style="margin-top: 12px; max-width: 400px;">
          <div>
            <label class="rotulo" for="disp-cfg-url">URL do Motor</label>
            <input class="campo" type="text" id="disp-cfg-url" placeholder="http://localhost:8080">
          </div>
        </div>
        <button class="btn btn--pequeno" id="disp-btn-salvar-cfg" style="margin-top: 12px;">Salvar URL no Navegador</button>
      </div>
    </div>
  `;

  ligar(alvo, clientesAtuais);
}

function ligar(alvo, clientesIniciais) {
  const btnEnviar = alvo.querySelector('#disp-btn-enviar');
  const txtMensagem = alvo.querySelector('#disp-mensagem');
  const divLista = alvo.querySelector('#disp-lista-clientes');
  const logDiv = alvo.querySelector('#disp-log');
  const barraProgresso = alvo.querySelector('#disp-progresso');
  const statusTexto = alvo.querySelector('#disp-status-texto');
  const btnImportar = alvo.querySelector('#disp-importar-wpp');
  
  const inpUrl = alvo.querySelector('#disp-cfg-url');
  
  inpUrl.value = localStorage.getItem('MOTOR_WPP_URL') || 'http://localhost:8080';

  let contatosAtuais = clientesIniciais.map(c => ({
    nome: c.contato || c.nome,
    telefone: c.telefone
  }));

  function renderizarLista() {
    if (contatosAtuais.length === 0) {
      divLista.innerHTML = '<div class="pequeno suave" style="padding: 12px; text-align: center;">Nenhum contato disponível. Clique em "Puxar do WhatsApp" ou adicione clientes na base.</div>';
      return;
    }
    divLista.innerHTML = contatosAtuais.map((c, i) => `
      <label class="linha" style="padding: 6px; cursor: pointer; border-bottom: 1px solid var(--cor-fundo);">
        <input type="checkbox" class="disp-cliente-cb" data-idx="${i}" checked>
        <div style="margin-left: 8px;">
          <div class="forte pequeno">${esc(c.nome)}</div>
          <div class="minusculo suave">${esc(c.telefone)}</div>
        </div>
      </label>
    `).join('');
  }

  renderizarLista();

  alvo.querySelector('#disp-btn-salvar-cfg').addEventListener('click', () => {
    localStorage.setItem('MOTOR_WPP_URL', inpUrl.value.trim());
    avisar('URL do Motor salva neste navegador.', 'ok');
  });

  alvo.querySelector('#disp-selecionar-todos').addEventListener('click', () => {
    alvo.querySelectorAll('.disp-cliente-cb').forEach(cb => cb.checked = true);
  });

  alvo.querySelector('#disp-desmarcar-todos').addEventListener('click', () => {
    alvo.querySelectorAll('.disp-cliente-cb').forEach(cb => cb.checked = false);
  });

  btnImportar.addEventListener('click', async () => {
    const url = inpUrl.value.trim();
    if (!url) {
      avisar('Informe a URL do motor antes de importar.', 'erro');
      return;
    }
    btnImportar.disabled = true;
    btnImportar.textContent = 'Puxando...';
    try {
      const resp = await fetch(url + '/contacts');
      if (!resp.ok) {
        throw new Error('Falha ao conectar no Motor. Verifique se ele está aberto.');
      }
      const data = await resp.json();
      if (data.error) throw new Error(data.message);
      
      // Limpar e carregar novos
      contatosAtuais = data.contacts;
      renderizarLista();
      avisar(`${contatosAtuais.length} contatos importados do WhatsApp com sucesso!`, 'ok');
    } catch (err) {
      avisar('Erro: ' + err.message, 'erro');
    } finally {
      btnImportar.disabled = false;
      btnImportar.textContent = '📲 Puxar do WhatsApp';
    }
  });

  function addLog(msg, tipo = 'info') {
    const cor = tipo === 'erro' ? 'var(--cor-risco)' : (tipo === 'ok' ? 'var(--cor-ok)' : 'inherit');
    const p = document.createElement('div');
    p.style.color = cor;
    p.textContent = msg;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  btnEnviar.addEventListener('click', async () => {
    const checkboxes = Array.from(alvo.querySelectorAll('.disp-cliente-cb')).filter(cb => cb.checked);
    const textoBase = txtMensagem.value.trim();

    if (checkboxes.length === 0) {
      avisar('Selecione pelo menos um contato.', 'erro');
      return;
    }
    if (!textoBase) {
      avisar('A mensagem não pode estar vazia.', 'erro');
      return;
    }
    
    const baseUrl = inpUrl.value.trim();
    if (!baseUrl) {
      avisar('Preencha a URL do Motor.', 'erro');
      return;
    }

    if (!confirm(`Tem certeza que deseja enviar mensagem para ${checkboxes.length} contatos?`)) {
      return;
    }

    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Disparando... (Mantenha esta tela aberta)';
    logDiv.innerHTML = '';
    barraProgresso.max = checkboxes.length;
    barraProgresso.value = 0;

    addLog('Iniciando disparos...', 'info');

    let sucessos = 0;
    let erros = 0;

    for (let i = 0; i < checkboxes.length; i++) {
      const idx = parseInt(checkboxes[i].dataset.idx);
      const contato = contatosAtuais[idx];
      const nome = contato.nome || '';
      const telefoneBruto = contato.telefone || '';
      
      let fone = telefoneBruto.replace(/\D/g, '');
      if (fone.length === 10 || fone.length === 11) {
        fone = '55' + fone;
      }

      const mensagemFinal = textoBase.replace(/{nome}/gi, nome);

      try {
        addLog(`Enviando para ${nome} (${fone})...`, 'info');
        
        // Passamos 'padrao' na rota pois a API anterior pedia :instance
        const response = await fetch(`${baseUrl}/message/sendText/padrao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: fone,
            text: mensagemFinal
          })
        });
        
        if (!response.ok) {
           const errData = await response.json();
           throw new Error(errData.message || 'Falha na API');
        }

        addLog(`✅ Mensagem entregue para ${nome}`, 'ok');
        sucessos++;
      } catch (err) {
        addLog(`❌ Erro ao enviar para ${nome}: ${err.message}`, 'erro');
        erros++;
      }

      barraProgresso.value = i + 1;
      statusTexto.textContent = Math.round(((i + 1) / checkboxes.length) * 100) + '%';

      if (i < checkboxes.length - 1) {
        const delay = Math.floor(Math.random() * (12000 - 6000 + 1)) + 6000;
        addLog(`Aguardando ${Math.round(delay/1000)}s para evitar spam...`, 'info');
        await new Promise(r => setTimeout(r, delay));
      }
    }

    addLog(`Disparo finalizado. Sucessos: ${sucessos}, Erros: ${erros}`, 'info');
    btnEnviar.disabled = false;
    btnEnviar.textContent = 'Iniciar Disparo';
  });
}
