# Agente Portal Comercial

Agente de IA que constrói e mantém o **Portal Comercial de Campo** — um site estático,
publicado no GitHub Pages, que reúne num só lugar as quatro ferramentas do dia a dia de
um representante comercial:

| Módulo | O que faz |
|---|---|
| 💰 **Cotações** | Monta o pedido no formato da Sigma, com busca instantânea entre 521 itens, IPI calculado na hora, semáforo de estoque à vista e PDF limpo para enviar ao cliente |
| 👥 **Carteira** | Os 328 clientes pesquisáveis e filtráveis, com contato, situação e histórico |
| 🗺️ **Mapa** | Todos os clientes plotados no Rio de Janeiro — enxergar quem está perto de quem |
| 📅 **Agenda** | Agendar, roteirizar e registrar visitas, sincronizado entre PC e celular |

## Como usar o agente

No Claude Code, dentro desta pasta:

```bash
claude
```

O agente lê `CLAUDE.md` sozinho e sabe o que fazer. Peça em português:

- *"importa a tabela de preços nova"* → skill `importar-dados`
- *"constrói a tela de cotações"* → skill `sistema-cotacoes`
- *"monta o mapa dos clientes"* → skill `carteira-e-mapa`
- *"quero a agenda de visitas"* → skill `agenda-visitas`
- *"configura o login e o banco"* → skill `integrar-supabase`
- *"publica no GitHub Pages"* → skill `publicar-portal`

Também dá para chamar o subagente de qualquer lugar do repositório:
`.claude/agents/portal-comercial.md`.

## Estado atual

✅ **No ar:** base de conhecimento, 6 skills, scripts de importação, Supabase com
esquema + RLS testado sob ataque, **e o portal completo** — login, cotações, carteira,
mapa e agenda, tudo verificado no navegador contra o banco real.

⏳ **Falta:** publicar no GitHub Pages e ligar a sincronização semanal do Sheets.

📋 **Aberto:** as pendências de `PENDENCIAS.md` — dados de cabeçalho do pedido
(CNPJ, numeração, condições de pagamento) e a confirmação dos limiares de estoque.

## Começo rápido

### 1. Importar os dados

```bash
python ferramentas/inspecionar_planilha.py "caminho/Tabela de precos.xlsx"
```

Confere se o layout da planilha mudou (ela é atualizada toda semana). Se acusar
divergência, **pare** — importar com layout diferente gera dado errado em silêncio.

```bash
python ferramentas/importar_precos.py "caminho/Tabela de precos.xlsx" \
    --saida dados/privado/catalogo.json

python ferramentas/importar_clientes.py \
    --inativos "caminho/Clientes inativos.xlsx" \
    --recuperacao "caminho/Clientes em recuperacao.xlsx" \
    --saida dados/privado/clientes.json
```

### 2. Geocodificar (uma vez, ~6 minutos)

Antes: abra `ferramentas/geocodificar.py` e preencha `CONTATO` com um e-mail real —
o Nominatim recusa requisições sem identificação.

```bash
pip install requests
python ferramentas/geocodificar.py dados/privado/clientes.json
```

### 3. Configurar o Supabase

Peça ao agente: *"configura o Supabase"*. Ele cria o esquema, o RLS, o login por
e-mail e senha, e a sincronização automática de preços.

### 3b. Rodar o portal localmente

**Dê dois cliques em `Abrir Portal.cmd`.** Ele sobe o servidor e abre o navegador.

⚠️ **Não abra o `portal/index.html` clicando no arquivo.** O navegador bloqueia
JavaScript em `file://` por segurança e a tela fica vazia. O portal precisa de um
servidor — é o que o atalho faz.

Pela linha de comando, se preferir:

```bash
python -m http.server 8123 --directory portal
```

Depois abra `http://localhost:8123` e entre com uma conta cadastrada em `representantes`.

### 4. Publicar

Peça ao agente: *"publica o portal"*. Antes de subir, ele roda
`ferramentas/testar_rls.py`, que **cria uma conta atacante, ataca o seu banco e a
apaga** — e não deixa publicar se algum teste falhar.

## Requisitos

- **Python 3.10+** com `openpyxl` e `requests`
- **Conta GitHub** (plano Free basta)
- **Conta Supabase** (Free) e **conta Google** — só para o Google Sheets

## 🔒 Como a segurança funciona

**O site é público. Os dados não.**

Quem abrir a URL vê uma **tela de login** e nada mais. Os 328 clientes vivem no Postgres
do Supabase, atrás de Row Level Security — nunca no repositório, nunca no JavaScript.
O login é por **e-mail e senha**, restrito a uma allowlist que você controla.

Isso tem duas consequências práticas:

- **O GitHub Pro deixa de ser necessário.** Sem dado no repositório, ele pode ser
  público e o Pages funciona no plano **Free**. (Privado continua sendo boa prática,
  mas aí volta o custo de ~US$ 4/mês.)
- **O RLS vira a única fronteira de segurança.** Precisa ser *testado*, não presumido.
  A skill `publicar-portal` começa exatamente por isso e não deixa publicar sem passar.

**Regras que não se quebram:**
1. A planilha original e qualquer dado de cliente **nunca** entram no repositório.
2. A chave **secret** do Supabase vive só nos GitHub Secrets — jamais no frontend.
3. Toda tabela com RLS ligado, e **nenhuma policy com `using (true)`**: "estar logado"
   não é permissão — é preciso estar cadastrado em `representantes`.

Detalhes em `conhecimento/09-publicacao-e-seguranca.md` e
`conhecimento/10-supabase-auth-e-dados.md`.

## Estrutura

```
Agente-Portal-Comercial/
├── CLAUDE.md              # instruções do agente (lidas automaticamente)
├── PENDENCIAS.md          # o que NÃO pode ser inventado
├── conhecimento/          # base de conhecimento (01 a 10)
├── .claude/skills/        # as 6 skills operacionais
├── ferramentas/           # scripts Python de importação e geocodificação
├── modelos/               # SQL do Supabase + workflow do GitHub Actions
├── dados/privado/         # staging da carga inicial — NUNCA versionado
└── portal/                # o site pronto — é isto que vai ao ar
```

## O que o agente já sabe sobre os dados

Levantado direto dos arquivos, não presumido:

- **521 itens** com preço · 24 grupos · 12 categorias
- **Semáforo de estoque** decodificado da formatação condicional da planilha:
  🔴 **69 sem estoque** (saldo < 6) · 🟡 **111 acabando** (< 200) · 🟢 331 ok · 10 sem dado
- **328 clientes** (300 inativos + 28 em recuperação, sem sobreposição)
- **317 no RJ**, 46 cidades, 170 bairros — com clusters densos que viram roteiro
- **3 bugs na planilha atual**, que o portal corrige:
  - `SUM(I20:I538)` deixa os itens **520 e 521 fora do total** — pedido fecha por menos
  - `VLOOKUP(...$A$1:$B$12)` faz **"Ventilador" retornar `#N/A`** em 12 capacitores
  - O semáforo usa `<6` e `>6`, então **saldo exatamente 6 não pega cor nenhuma**
    (`SCT-00952-W` parece ter estoque normal, mas tem 6 unidades)

Comissão e ST **não são calculados** — decisão do usuário. Só IPI entra na conta.

Contexto completo em `conhecimento/01-negocio-e-dominio.md`.
