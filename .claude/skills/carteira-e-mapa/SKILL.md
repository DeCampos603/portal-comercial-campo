---
name: carteira-e-mapa
description: Constrói a aba de clientes (lista filtrável) e o mapa do Rio de Janeiro com os clientes plotados, agrupamento de pinos, filtros por status e região, e roteiro por proximidade. Use quando o usuário pedir a lista de clientes, a carteira, o mapa, a localização dos clientes, ou filtros e busca de cliente.
---

# Carteira e mapa

Dois módulos que compartilham os mesmos dados e filtros: a **lista** (para procurar e
trabalhar) e o **mapa** (para enxergar e planejar).

## Antes de começar

Leia `conhecimento/04-dados-de-clientes.md` e `conhecimento/05-mapa-e-geocodificacao.md`.
Confirme que `portal/dados/clientes.json` existe e tem `geo` preenchido — se não,
rode antes a skill `importar-dados`.

## Parte 1 — A carteira (lista)

### Estado e filtros compartilhados

Lista e mapa leem **o mesmo estado de filtro**. Filtrar em um reflete no outro — isso é
o que faz os dois módulos parecerem um só sistema.

```js
const filtros = {
  texto: '',            // nome, código, bairro, cidade
  status: [],           // Sem Título | Com Título | Atrasado
  origem: [],           // inativo | recuperacao
  cidade: [],
  bairro: [],
  semVisitaAgendada: false,
  raioKm: null,         // a partir da posição atual
};
```

### A lista

- **Busca instantânea** em nome, código, bairro e cidade (normalizada, sem acento).
- **Virtualização** — 328 linhas renderizadas de uma vez travam o celular.
- Colunas: nome · status · bairro/cidade · telefone · última visita · ações.
- Ações por linha: `Ligar` · `WhatsApp` · `Ver no mapa` · `Agendar` · `Cotar`.
- Ordenações: alfabética · mais tempo sem visita · por cidade/bairro.

### A ficha do cliente

Painel lateral (não modal — o usuário precisa continuar vendo a lista):
dados cadastrais · status · **contato** (editável) · **notas** (editável) ·
histórico de visitas · cotações geradas.

`contato` e `notas` gravam no Supabase (skill `integrar-supabase`). São os dois campos
que transformam a carteira de foto morta em sistema vivo — a origem tem 328 contatos
vazios.

## Parte 2 — O mapa

### Montagem

```js
const mapa = L.map('mapa', {
  center: [-22.9068, -43.1729],
  zoom: 11,
  preferCanvas: true,        // essencial com centenas de pinos
});

L.tileLayer('./assets/vendor/leaflet/tiles/{z}/{x}/{y}.png' /* ou OSM */, {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(mapa);
```

A atribuição do OpenStreetMap é **exigência de licença**. Não remova.

### Regras dos pinos

- **Agrupamento obrigatório** — 137 clientes no Rio viram uma mancha sem isso.
- Cor por status: 🔴 Atrasado · 🟡 Com Título · 🟢 Sem Título · ⭐ em recuperação.
- **Cor nunca sozinha**: combine com forma/ícone e sempre com rótulo no popup.
- Pino com `precisao: "cidade"` ganha marca visual de aproximado — senão o usuário
  monta roteiro em cima de uma coordenada que não é o endereço real.

### Popup

Layout em `conhecimento/05`. O essencial: identificação, situação, contato e **botões
de ação** (`Agendar` · `Cotar` · `Rota` · `Ficha`). O mapa só vale se leva à ação sem
retrabalho.

"Traçar rota" abre o app de navegação do celular:
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` — sem API, sem custo.

### Funções de campo (as mais usadas na rua)

1. **"Perto de mim"** — `navigator.geolocation` + raio ajustável. Responde à pergunta
   que o usuário realmente faz: *"terminei aqui, quem tem por perto?"*
2. **Roteiro do dia** — plota só as visitas agendadas, na ordem, com linha ligando.
3. **Corredores** — filtro rápido pelos agrupamentos de `conhecimento/05`
   (Leopoldina, Centro, Baixada, Niterói/São Gonçalo…).

### Roteirização

Vizinho mais próximo (código em `conhecimento/05`). **Chame de "sugestão de ordem",
nunca de "rota otimizada"** — é distância em linha reta, ignora trânsito. No Rio isso
importa muito. Deixe o usuário arrastar para reordenar: ele conhece o trânsito.

## Desempenho

| Item | Alvo |
|---|---|
| Abertura do mapa com 328 pinos | < 1 s |
| Aplicar filtro | < 100 ms |
| Busca na lista | < 50 ms |

Se passar disso: confirme `preferCanvas: true`, o agrupamento e a virtualização da lista.

## Checklist

```
[ ] 328 clientes na lista, 328 pinos no mapa (bate com o relatório de importação)
[ ] Filtro da lista reflete no mapa e vice-versa
[ ] Cliente sem coordenada aparece na lista com aviso (não some calado)
[ ] Pino aproximado (precisão cidade) está visualmente marcado
[ ] Cor + ícone + texto no status (não só cor)
[ ] Popup com ações funcionando: agendar, cotar, rota, ficha
[ ] "Perto de mim" pede permissão e funciona no celular
[ ] Atribuição do OpenStreetMap visível
[ ] Contato e notas salvam e persistem após recarregar
[ ] Testado no celular, em 3G lento
```
