# 08 — Design e UX

## A premissa

Isto **não é um site**. É uma **ferramenta de trabalho** usada todo dia, muitas vezes
por dia, por uma pessoa com pressa — às vezes de pé, no balcão do cliente, segurando o
celular com uma mão.

A consequência prática: **densidade e velocidade valem mais que beleza**. Um site
institucional quer impressionar em 5 segundos; uma ferramenta de trabalho quer
desaparecer e deixar o usuário trabalhar. Espaço em branco generoso, animação de
entrada e hero gigante são inimigos aqui.

Critério de sucesso: **montar uma cotação de 15 itens em menos de 2 minutos.**

## Identidade visual

Sóbria, profissional, alta legibilidade. O usuário mostra essa tela para o cliente —
tem que passar credibilidade, não parecer planilha nem parecer startup.

```css
:root {
  /* Neutros — a base da interface */
  --cor-fundo:        #f6f7f9;
  --cor-superficie:   #ffffff;
  --cor-borda:        #d8dce3;
  --cor-texto:        #16202c;
  --cor-texto-suave:  #5b6875;

  /* Marca — azul sério, de ferramenta industrial */
  --cor-primaria:      #14538a;
  --cor-primaria-forte:#0e3d67;

  /* Semânticas — usadas com significado fixo, nunca decorativo */
  --cor-ok:      #1a7f4b;   /* Sem Título / sincronizado / realizada */
  --cor-atencao: #b5730c;   /* Com Título / pendente / saldo baixo   */
  --cor-risco:   #b3261e;   /* Atrasado / erro / saldo zero          */
  --cor-info:    #14538a;   /* Em recuperação / destaque neutro      */

  /* Tipografia */
  --fonte: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --fonte-numero: 'Segoe UI', ui-monospace, 'Cascadia Mono', monospace;

  /* Escala de espaçamento — múltiplos de 4 */
  --e1: 4px;  --e2: 8px;  --e3: 12px; --e4: 16px; --e6: 24px; --e8: 32px;

  --raio: 6px;                     /* discreto: ferramenta, não app de consumo */
  --sombra: 0 1px 3px rgb(0 0 0 / .08);
}
```

**Fonte do sistema, não Google Fonts.** Carrega instantâneo, funciona offline, e não
manda o IP do usuário para o Google (LGPD — ver `09`).

### Números precisam de fonte tabular

Coluna de preço com dígitos de larguras diferentes é ilegível e parece amadorismo:

```css
.numero, td.valor, .total {
  font-variant-numeric: tabular-nums;
  font-family: var(--fonte-numero);
  text-align: right;          /* dinheiro SEMPRE alinhado à direita */
}
```

## Cores semânticas: a regra

As cores de status têm significado **fixo** em todo o portal. Um cliente vermelho no
mapa é o mesmo vermelho da carteira e da agenda. Nunca use vermelho para decorar.

### Dois semáforos, dois contextos

O portal tem **duas** escalas vermelho/amarelo/verde. Elas nunca aparecem na mesma
tabela, então não competem — mas o rótulo textual é obrigatório para não confundir:

| Contexto | 🔴 | 🟡 | 🟢 |
|---|---|---|---|
| **Estoque** (itens, na cotação) | sem estoque (<6) | acabando (<200) | disponível |
| **Cliente** (carteira, mapa) | Atrasado | Com Título | Sem Título |

O semáforo de estoque replica a formatação condicional da planilha — é a informação
que o usuário já usa hoje para decidir o que cotar, e é **requisito de negócio de
primeira ordem**. Mostre sempre **selo + saldo real**, nunca a cor sozinha:

```html
<span class="selo selo--risco" title="Menos de 6 unidades">
  <svg aria-hidden="true">…</svg>
  Sem estoque · 3 un.
</span>
```

O número importa: "sem estoque · 3 un." é acionável ("dá para 1 pedido pequeno");
só a cor vermelha não é.

⚠️ **Cor nunca é o único sinal.** ~8% dos homens têm alguma daltonia. Toda cor vem
acompanhada de **ícone ou texto**:

```html
<span class="selo selo--risco">
  <svg aria-hidden="true">…</svg>
  Atrasado
</span>
```

## Responsividade

| Faixa | Contexto | Layout |
|---|---|---|
| < 640 px | Celular, em campo, uma mão | Coluna única, navegação inferior, alvos ≥44 px |
| 640–1024 px | Tablet, escritório | Duas colunas, tabela com scroll horizontal |
| > 1024 px | Desktop, montando pedido | Tabela densa, painéis laterais, atalhos |

**Mobile-first no CSS**, mas **desktop-first na densidade**. No celular o usuário
*consulta* e *registra*; no desktop ele *produz*. São modos de uso diferentes, não a
mesma tela em tamanhos diferentes.

```css
/* Base = celular. Depois acrescenta densidade. */
.tabela-cotacao { display: block; }             /* cards empilhados */

@media (min-width: 1024px) {
  .tabela-cotacao { display: table; }           /* tabela de verdade */
  .tabela-cotacao td { padding: var(--e2) var(--e3); font-size: .875rem; }
}
```

## Teclado (o ganho oculto de produtividade)

No desktop, montar um pedido tem que ser possível **sem tocar no mouse**:

| Tecla | Ação |
|---|---|
| `/` | Foco na busca (de qualquer lugar) |
| `↑` `↓` | Navega nos resultados |
| `Enter` | Adiciona o item e move o foco para a quantidade |
| `Enter` (na qtd.) | Confirma e volta para a busca |
| `Esc` | Limpa a busca / fecha o painel |
| `Ctrl+P` | Gera o PDF do pedido |
| `Ctrl+S` | Salva a cotação |

Esse ciclo — buscar, `Enter`, quantidade, `Enter` — é o que permite 15 itens em 2
minutos. É a diferença mais concreta em relação a rolar uma planilha de 521 linhas.

## Estados: os quatro que sempre existem

Todo componente que carrega dado precisa dos quatro. Esquecer um é o defeito de UX
mais comum:

1. **Carregando** — esqueleto do layout, não spinner girando no vazio.
2. **Vazio** — explica o porquê e dá a próxima ação ("Nenhuma visita hoje. [Planejar]").
3. **Erro** — diz o que houve e como resolver ("Sem conexão. Mostrando dados de 25/07.").
4. **Cheio** — o caso normal.

## Feedback: o usuário nunca pode duvidar

- **Salvou?** Indicador de sincronização sempre visível (`✅ / 🔄 / ⏳ 3 / ⚠️`).
- **Qual a data do dado?** Rodapé com "Preços de 25/07/2026 às 08:12".
- **Vai dar problema?** Aviso *antes*: saldo zero, tabela vencida, cliente atrasado.
- **Ação destrutiva?** Confirmação com o nome do que será apagado, e **desfazer** por
  10 segundos. Excluir uma cotação de 20 itens por engano não pode ser irreversível.

## Impressão — o PDF do pedido

O PDF é gerado com `window.print()` + CSS. Zero dependência, resultado nativo e fiel.

```css
@media print {
  /* Some tudo que é interface */
  .navegacao, .barra-busca, .botoes, .painel-lateral,
  .indicador-sinc, .filtros { display: none !important; }

  /* 🔒 Segurança: nunca imprimir dado interno. Cinto e suspensório —
     o filtro de sanitização em JS já removeu, isto é a segunda barreira. */
  .comissao, .saldo, .categoria, .custo, .margem { display: none !important; }

  @page { size: A4 portrait; margin: 12mm; }

  body { font-size: 10pt; color: #000; background: #fff; }

  /* Cabeçalho da tabela repete em toda página — pedido tem várias folhas */
  thead { display: table-header-group; }
  tr, .bloco-total { break-inside: avoid; }

  /* Mostra o destino dos links, já que não dá para clicar no papel */
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 8pt; }
}
```

O PDF precisa sair no **formato do pedido Sigma** — cabeçalho, itens, totais,
condições, campos de aprovação. Ele é um documento comercial, não um print de tela.

## Acessibilidade (mínimo obrigatório)

- Contraste **4.5:1** em texto normal, 3:1 em texto grande. Verifique os tons de status.
- **Foco visível** em tudo que recebe teclado — nunca `outline: none` sem substituto.
- Alvo de toque **≥44×44 px** no celular.
- `<label>` real em todo campo. `placeholder` não é rótulo.
- Tabela com `<th scope="col">`, `<caption>` e `aria-live` nos totais que mudam sozinhos.
- Respeite `prefers-reduced-motion` — e, de todo modo, use pouca animação.

## PWA — instalar no celular

O `manifest.webmanifest` + Service Worker fazem o portal virar ícone na tela inicial,
abrindo em tela cheia, sem barra de navegador. Em campo isso importa: parece aplicativo,
abre rápido, funciona sem sinal.

```json
{
  "name": "Portal Comercial de Campo",
  "short_name": "Portal",
  "start_url": "./index.html",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#f6f7f9",
  "theme_color": "#14538a",
  "icons": [
    { "src": "assets/icones/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "assets/icones/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "assets/icones/512-mask.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

⚠️ Em GitHub Pages o site fica em subdiretório (`/repositorio/`). Use **caminhos
relativos** (`./`) em `start_url`, ícones e no registro do Service Worker — caminho
absoluto (`/`) aponta para a raiz do domínio e quebra tudo.

## 🔴 Verificar renderização, não DOM

**Este projeto já perdeu uma sessão inteira por causa disto.** O portal foi declarado
"funcionando" com base em consultas ao DOM — `innerHTML.length`, `elemento.style.display`,
`querySelectorAll(...).length` — enquanto a tela estava **completamente preta** para o
usuário.

A causa era `display: none !important` na classe `.oculto` vencendo um `style.display`
inline. O DOM inteiro existia, montado e correto. Só não era pintado.

**Consulta ao DOM funciona igual em elemento invisível.** Não prova nada sobre o que o
usuário vê.

### O que serve como prova

```js
// ❌ NÃO prova que aparece
elemento.style.display === 'contents'
document.getElementById('conteudo').innerHTML.length > 0
document.querySelectorAll('.cartao').length

// ✅ Prova que está pintado na tela
const r = elemento.getBoundingClientRect();
r.width > 0 && r.height > 0

getComputedStyle(elemento).display          // o computado, não o inline
document.elementFromPoint(x, y)             // o que está de fato naquele pixel
document.body.innerText.trim().length > 0   // texto visível, não markup
```

E, sempre que possível, **um print de tela**. Se a ferramenta de screenshot falhar,
isso é motivo para desconfiar do resultado — não para seguir com verificação mais fraca
e relatar sucesso.

### Armadilha do `!important`

`.oculto { display: none !important }` vence estilo inline. Para mostrar um elemento
que nasce com essa classe, **tire a classe** — mexer só no `style.display` não adianta:

```js
elemento.classList.toggle('oculto', !mostrar);   // primeiro isto
elemento.style.display = mostrar ? 'contents' : 'none';
```

## Erros de design a evitar aqui

| ❌ Não faça | ✅ Faça |
|---|---|
| Hero grande com imagem | Ir direto ao trabalho: busca e ações |
| Paginação de 20 em 20 | Lista virtualizada com busca instantânea |
| Modal para cada ação | Edição no lugar, painel lateral |
| Confirmar tudo | Ação direta + **desfazer** |
| Ícone sem rótulo | Ícone **com** texto (ambiguidade custa tempo) |
| Cor como único sinal | Cor + ícone + texto |
| Animação de transição | Resposta imediata |
| "Erro inesperado" | O que falhou, onde e o que fazer agora |
