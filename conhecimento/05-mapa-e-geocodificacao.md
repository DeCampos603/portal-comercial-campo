# 05 — Mapa e geocodificação

## Base do mapa: CARTO Voyager, não o estilo padrão do OSM

Os dados são os mesmos do OpenStreetMap; o que muda é o **estilo**. O padrão do
OSM foi desenhado para quem EDITA o mapa: mostra ícone de cada ponto de
interesse, linha de balsa, uso do solo em cores fortes. Com 378 pinos por cima,
isso vira ruído — o pino compete com o mapa em vez de se destacar dele.

Medido no mesmo tile do Centro do Rio (z13/3113/4631):

| Base | Bytes | Resposta |
|---|---|---|
| OSM padrão | 22,8 KB | 191 ms |
| CARTO Voyager | 19,9 KB | 9 ms |
| CARTO Positron | 15,4 KB | 58 ms |

Voyager e não Positron: o Positron é lindo e quase não tem rótulo nesse zoom,
o que não sustenta roteiro. Voyager mantém a hierarquia de vias legível.

- `{r}` + `detectRetina: true` pede `@2x` só onde a tela aproveita.
- `dark_all` no tema escuro, trocado ao vivo por `matchMedia`.
- **Duas atribuições obrigatórias:** OpenStreetMap (dados) e CARTO (estilo).
- Ao trocar o provedor, atualize também a CSP (`img-src`) em `index.html` **e**
  a regra de cache de tiles no `sw.js`. Esquecer o `sw.js` quebra o mapa
  offline em silêncio — justo quando ele mais importa.
- É serviço gratuito com uso justo. Para esta escala (2 representantes) sobra;
  se um dia virar produto para muitos usuários, revisar os termos da CARTO.

## Por que Leaflet + OpenStreetMap

| Opção | Custo | Chave | Veredito |
|---|---|---|---|
| **Leaflet + OSM** | Grátis | Não | ✅ **Escolhida** |
| Google Maps JS API | Pago após crédito | Sim, exposta no frontend | ❌ Chave visível = fatura de terceiros |
| Mapbox | Grátis até 50k/mês | Sim, exposta | ❌ Mesmo problema, e cobra depois |

Num site estático, **qualquer chave de API fica visível no código-fonte**. Com repo
privado o risco cai, mas o JS baixado pelo navegador continua legível. Leaflet + OSM
elimina o problema: sem chave, sem cadastro, sem fatura.

Baixe o Leaflet e versione em `portal/assets/vendor/leaflet/`. Não use CDN — offline e
privacidade (ver `02`).

## Geocodificação: a decisão central

**Geocodifique uma vez, no computador, e versione o resultado. Nunca em runtime.**

Motivos:
- O Nominatim (geocoder do OSM) limita a **1 requisição por segundo** e proíbe uso em
  massa pelo navegador. 328 clientes = 5,5 minutos de espera na abertura do site.
- Os endereços praticamente não mudam. Recalcular a cada visita é desperdício.
- Offline: sem cache local, o mapa morre sem sinal.

Resultado: `portal/dados/geo.json`, um mapa `CEP → {lat, lng}`.

⚠️ `geo.json` contém a localização de clientes reais. Ele está coberto pelo
`.gitignore` do projeto — só entra no repositório **privado** de publicação.

## Estratégia em cascata (do mais preciso ao mais grosseiro)

Como o `Logradouro` não tem número, a melhor precisão possível é **nível de rua/CEP**.

```
1. ViaCEP           → confirma logradouro/bairro/cidade a partir do CEP   (grátis, sem limite prático)
2. Nominatim (OSM)  → busca "logradouro, bairro, cidade, UF, Brasil"      (1 req/s)
3. Nominatim        → busca só "CEP, Brasil"                              (fallback)
4. Centroide do bairro                                                    (aproximado)
5. Centroide da cidade                                                    (último recurso)
```

Sempre grave **de onde veio** a coordenada:

```json
{
  "20000-000": { "lat": -22.9711, "lng": -43.4152, "precisao": "rua",    "fonte": "nominatim" },
  "26215072": { "lat": -22.7592, "lng": -43.4510, "precisao": "bairro", "fonte": "centroide" }
}
```

`precisao` alimenta a interface: um pino "rua" é confiável; um pino "cidade" precisa de
aviso visual, senão o usuário monta roteiro em cima de uma coordenada inventada.

## 🔴 A armadilha que já queimou este projeto

**Busca em texto livre com `limit=1` sempre devolve alguma coisa.** Se o Nominatim não
acha "Rua Exemplo, Duque de Caxias, RJ", ele devolve uma rua de nome parecido
**em qualquer lugar do Brasil** — sem avisar, sem erro.

Na primeira versão deste script, **63 dos 317 clientes do RJ (20%)** foram parar em
Paraná, Mato Grosso e Rio Grande do Sul. E o relatório dizia, com toda a confiança,
*"100% precisão de rua"* — porque o código rotulava como "rua" só por ter recebido
resposta, sem conferir onde ela caiu.

Isso é pior que não geocodificar: um pino errado vira roteiro errado, e o representante
só descobre dirigindo.

### As quatro defesas (todas obrigatórias)

**1. CEP primeiro, sempre.** É o identificador mais confiável do Brasil: aponta um
trecho de rua específico, imune a nomes repetidos. Medido nesta base:

| Endereço | Por nome de rua | Por CEP |
|---|---:|---:|
| Rua do Senado, Centro | 46,6 km do Centro ❌ | **2,0 km** ✅ |
| Rua José Bonifácio, Todos os Santos | 61,0 km ❌ | **11,5 km** ✅ |

"Rua da Conceição" existe no Centro e em Campo Grande. O CEP `20010-000` é um lugar só.
A carteira tem **100% de CEP preenchido** — use.

**2. Caixa do MUNICÍPIO, não do estado.** A caixa da UF não basta: o RJ tem várias ruas
de mesmo nome, e um endereço do Centro cai em Campos sem sair do estado. O Nominatim já
devolve a fronteira municipal exata em `boundingbox` — melhor que chutar um raio:

```python
# ao geocodificar a cidade uma vez, guarde o boundingbox
bb = resposta.json()[0]["boundingbox"]   # [lat_min, lat_max, lon_min, lon_max]
```

**3. `viewbox` + `bounded=1`** com essa caixa — o Nominatim não devolve nada fora dela.
Formato do viewbox: `<lon_esq>,<lat_topo>,<lon_dir>,<lat_base>`.

**4. Busca estruturada**, não texto livre, quando cair no fallback por logradouro:
`{"street": ..., "city": ..., "state": ...}` casa cada campo no nível certo da
hierarquia, em vez de virar sopa de palavras.

E, no fim, um **relatório que confere pino a pino** se caiu dentro do município do
cliente. Sem essa conferência, o erro volta silencioso na próxima planilha.

> **Regra:** melhor cliente sem pino do que pino no lugar errado. Quando a cascata não
> resolve dentro do município, devolva `None` e liste no relatório.

### A cascata final

```
1. CEP (postalcode)              -> precisão "rua"     ← quase tudo resolve aqui
2. street + city + state         -> precisão "rua"
3. bairro, cidade, UF            -> precisão "bairro"
4. centroide da cidade           -> precisão "cidade"
```

Todas restritas à caixa do município.

## Regras de uso do Nominatim (obrigatórias)

O Nominatim é mantido por doação. Violar a política derruba o serviço para todos e
resulta em bloqueio de IP.

1. **Máximo 1 requisição por segundo.** Sem paralelismo.
2. **`User-Agent` identificável** com forma de contato. Requisição sem isso é recusada.
3. **Cache obrigatório.** Nunca pedir duas vezes o mesmo endereço.
4. **Nunca chamar do navegador em massa.** Só do script de importação.

```python
import time, requests

CABECALHOS = {
    # Obrigatório: identifique a aplicação e um contato real.
    'User-Agent': 'PortalComercialCampo/1.0 ([[CONFIRMAR: e-mail de contato]])'
}

def geocodificar(consulta: str):
    """UMA consulta ao Nominatim, respeitando o limite de 1 req/s."""
    resposta = requests.get(
        'https://nominatim.openstreetmap.org/search',
        params={'q': consulta, 'format': 'json', 'limit': 1,
                'countrycodes': 'br', 'addressdetails': 1},
        headers=CABECALHOS, timeout=15,
    )
    time.sleep(1.1)                      # a pausa é parte do contrato, não otimização
    resposta.raise_for_status()
    dados = resposta.json()
    if not dados:
        return None
    return {'lat': float(dados[0]['lat']), 'lng': float(dados[0]['lon'])}
```

Para 328 clientes: ~6 minutos rodando uma vez. Salve o cache **a cada resultado**, não
no fim — se cair na metade, você não perde o que já foi feito.

## Expectativa realista de qualidade

Com endereço sem número, no Rio:

| Precisão | Esperado | Uso |
|---|---:|---|
| Rua exata | ~60–70% | ✅ Roteiro confiável |
| Bairro | ~20–30% | ⚠️ Serve para agrupar, não para navegar |
| Cidade | ~5–10% | ❌ Só para não sumir do mapa |

**Não tente chegar a 100%.** O ganho marginal não compensa. Exiba a precisão, deixe o
usuário corrigir manualmente os importantes e siga em frente. Um botão "corrigir
localização" que grava no Supabase resolve os casos que interessam.

## Interface do mapa

### O mapa base

```js
const mapa = L.map('mapa', {
  center: [-22.9068, -43.1729],   // Centro do Rio
  zoom: 11,
  preferCanvas: true,             // muito mais rápido com centenas de pinos
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(mapa);
```

A atribuição do OpenStreetMap é **exigência de licença**. Não remova.

### Agrupamento de pinos

328 pinos sobrepostos no Centro do Rio é uma mancha ilegível. Use agrupamento por
proximidade (`Leaflet.markercluster`, também local): em zoom baixo aparece "137" sobre
o Rio; ao aproximar, o grupo se abre.

### Cor do pino = status comercial

| Status | Cor | Leitura |
|---|---|---|
| `Atrasado` | 🔴 Vermelho | Inadimplente — cuidado antes de vender |
| `Com Título` | 🟡 Âmbar | Tem faturamento em aberto |
| `Sem Título` | 🟢 Verde | Sem pendência |
| Em recuperação | ⭐ Contorno | Já em processo de retomada |

⚠️ A semântica exata dos status é **pendência 🟢**. Confirme antes de pintar de vermelho
um cliente que talvez esteja em dia — errar isso constrange na frente do cliente.

**Acessibilidade:** cor sozinha não basta (8% dos homens têm daltonismo). Combine com
**forma** ou **ícone**, e sempre com rótulo textual no popup.

### O popup do cliente

Precisa responder, em um olhar: quem é, situação, como falar, quando visitei.

```
┌─────────────────────────────────────┐
│ CLIMA NORTE REFRIGERACAO LTDA         │
│ 🟡 Com Título · Inativo             │
├─────────────────────────────────────┤
│ 📍 Rua Exemplo               │
│    Centro, Duque de Caxias│
│    25000-000        [precisão: rua] │
│ 📞 (21) 3000-1111      [WhatsApp]   │
│ ✉️ contato@exemplo.com.br         │
├─────────────────────────────────────┤
│ Última visita: nunca                │
│ Contato: [[+ adicionar]]            │
├─────────────────────────────────────┤
│ [Agendar visita]  [Nova cotação]    │
│ [Traçar rota]     [Ver na carteira] │
└─────────────────────────────────────┘
```

Os botões são o ponto do mapa: do pino direto para a ação, sem retrabalho.
"Traçar rota" abre `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` —
usa o app de navegação do celular, sem custo nem API.

### Filtros (barra lateral)

Status · origem (inativo/recuperação) · cidade · bairro · com/sem visita agendada ·
raio a partir de um ponto ("clientes num raio de 5 km daqui").

O filtro de **raio a partir da posição atual** (via `navigator.geolocation`) é a função
mais útil em campo: *"terminei aqui em Bonsucesso, quem tem por perto?"*

## Roteirização

Não implemente TSP (caixeiro-viajante) de verdade — é complexo e desnecessário. Para
6–10 paradas, o **vizinho mais próximo** já produz um roteiro bom:

```js
/** Ordena paradas pelo vizinho mais próximo a partir de um ponto inicial. */
function ordenarPorProximidade(pontoInicial, clientes) {
  const restantes = [...clientes];
  const rota = [];
  let atual = pontoInicial;

  while (restantes.length) {
    let iMaisProximo = 0;
    let menorDistancia = Infinity;
    restantes.forEach((c, i) => {
      const d = distanciaHaversine(atual, c.geo);
      if (d < menorDistancia) { menorDistancia = d; iMaisProximo = i; }
    });
    const proximo = restantes.splice(iMaisProximo, 1)[0];
    rota.push(proximo);
    atual = proximo.geo;
  }
  return rota;
}
```

**Seja honesto sobre a limitação:** isso ordena por distância em **linha reta**, não por
tempo de trânsito. No Rio, 3 km atravessando o Centro às 17h ≠ 3 km na Linha Amarela.
Apresente como *"sugestão de ordem"*, nunca como *"rota otimizada"*, e deixe o usuário
arrastar para reordenar. Ele conhece o trânsito melhor que qualquer algoritmo aqui.

Para exportar o roteiro do dia para o celular:
`https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=lat,lng|lat,lng`
(limite de 9 waypoints — mais que suficiente para um dia de visitas).

## Corredores naturais do Rio (base do roteiro)

A carteira tem clusters densos. Sugira roteiros por corredor:

| Corredor | Bairros | Aprox. |
|---|---|---|
| **Leopoldina** | Bonsucesso, Ramos, Olaria, Penha, Penha Circular, Higienópolis | ~30 |
| **Centro** | Centro, Catete, Praça da Bandeira, São Cristóvão | ~50 |
| **Zona Norte / Méier** | Cascadura, Campinho, Madureira, Todos os Santos, Bento Ribeiro | ~20 |
| **Jacarepaguá / Barra** | Taquara, Curicica, Anil, Barra, Recreio, Camorim | ~25 |
| **Zona Oeste** | Campo Grande, Santa Cruz, Realengo, Inhoaíba | ~15 |
| **Baixada** | Nova Iguaçu, Duque de Caxias, S. J. de Meriti, Nilópolis, Mesquita | ~40 |
| **Niterói / S. Gonçalo** | Niterói, São Gonçalo, Itaboraí, Maricá | ~30 |
| **Região dos Lagos** | Araruama, Saquarema, Cabo Frio, Búzios, S. P. da Aldeia | ~10 |
| **Norte Fluminense** | Macaé, Rio das Ostras, Campos | ~22 |
| **Sul Fluminense** | Volta Redonda, Barra Mansa, Angra dos Reis | ~18 |

Um dia bem montado = um corredor. Isso é o que o mapa entrega e a planilha jamais entregou.
