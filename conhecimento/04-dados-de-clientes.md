# 04 — Dados de clientes: importação e limpeza

## 🔴 São TRÊS carteiras, não duas

A carga inicial recebeu `Clientes inativos.xlsx` e `Clientes em recuperação.xlsx` —
328 clientes que **pararam de comprar**. Faltava a carteira que sustenta o
faturamento: os **ativos**, que só chegaram em 03/08/2026, num arquivo exportado
com nome genérico (`cliente_<data>.xlsx`).

Enquanto isso, o mapa, a agenda e a fila de visitas trabalhavam sobre a carteira
morta e ignoravam a viva. Dos 51 ativos, **50 eram inéditos** — a sobreposição
com os 328 foi de um único cliente.

**Ao receber planilha de clientes, pergunte QUAL carteira é antes de importar.**
O arquivo não diz, o layout é idêntico nos três casos, e classificar errado é
invisível: nada falha, o cliente só aparece na gaveta errada.

| `origem` | Quantos | Peso na fila de visitas |
|---|---|---|
| `ativo` | 51 | 50 |
| `recuperacao` | 28 | 40 |
| `inativo` | 300 | 0 |

Precedência na importação: um cliente que aparece em duas listas fica com a
**mais ativa**. O contrário o esconderia justamente por estar comprando.

## Formato de origem

Os três arquivos têm **exatamente o mesmo layout**: uma aba `Sheet0`,
cabeçalho na linha 1, dados a partir da 2.

| Col | Cabeçalho | Estado real |
|---|---|---|
| A | `Cód. Cliente` | ✅ Íntegro, único, **chave primária** |
| B | `Cliente` | ⚠️ Razão social + sufixo `[código]` redundante |
| C | `Representante` | ❌ 100% idêntico — **descartar** |
| D | `Contato` | ❌ **100% vazio** nos 328 registros |
| E | `Fone` | ⚠️ Formatos misturados |
| F | `E-mail` | ⚠️ 10 vazios; alguns com espaço em branco |
| G | `Logradouro` | ⚠️ **Sem número**; prefixos inconsistentes |
| H | `Bairro` | ⚠️ Caixa e acentuação misturadas |
| I | `Cidade` | ⚠️ `SÃO GONÇALO` e `SAO GONCALO` coexistem |
| J | `UF` | ✅ Íntegro |
| K | `CEP` | ✅ 100% preenchido, sem máscara (8 dígitos) |
| L | `Status` | ✅ 3 valores fechados |

**Verificado:** os dois arquivos são conjuntos **disjuntos** (interseção = 0 códigos).
Podem ser concatenados com segurança, marcando a origem.

## Regras de limpeza

### 1. Nome do cliente — remover o sufixo redundante

```python
import re
# "REFRIRIO COMERCIO DE PECAS LTDA [21152]" -> "REFRIRIO COMERCIO DE PECAS..."
def limpar_nome(bruto: str) -> str:
    nome = re.sub(r'\s*\[\d+\]\s*$', '', str(bruto).strip())
    return re.sub(r"^'", '', nome).strip()   # alguns começam com apóstrofo do Excel
```

⚠️ Alguns nomes **começam com CNPJ/CPF parcial** (`"11.391.987 CLAUDIO LUIZ TEIXEIRA
BARBOSA"`, `"39.666.231 FABRICIO DIAS DE OLIVEIRA"`). São MEIs cujo nome fantasia é o
próprio documento. **Não remova** — é o identificador real do cliente. Se quiser exibir
melhor, separe em `documentoParcial` + `nome`, mas preserve o original.

### 2. Telefone — normalizar sem perder informação

Formatos encontrados: `(21) 30000000` · `21970665876` · `(021) 5333277` · `2134849050`

```python
def normalizar_telefone(bruto):
    if not bruto or not str(bruto).strip():
        return None
    d = re.sub(r'\D', '', str(bruto))
    if d.startswith('0') and len(d) > 10:      # DDD com zero à frente: (021)
        d = d[1:]
    if len(d) == 11:    return f'({d[:2]}) {d[2:7]}-{d[7:]}'   # celular
    if len(d) == 10:    return f'({d[:2]}) {d[2:6]}-{d[6:]}'   # fixo
    return str(bruto).strip()   # não reconhecido: preserve o original, não descarte
```

Guarde também `telefoneE164` (`+5521970665876`) para os links `wa.me` do WhatsApp.
Atenção: números de 10 dígitos podem ser fixos **ou** celulares antigos sem o 9 —
não presuma que dá WhatsApp.

### 3. Cidade — normalizar mantendo o acento correto

O problema: `SÃO GONÇALO` e `SAO GONCALO` são a mesma cidade, contadas separado.

```python
import unicodedata

def chave_cidade(nome):
    """Chave de comparação: sem acento, maiúscula, sem espaço duplo."""
    s = unicodedata.normalize('NFKD', str(nome).upper())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return ' '.join(s.split())

# Agrupe pela chave, exiba com a grafia oficial (IBGE).
CIDADES_RJ = {
    'SAO GONCALO': 'São Gonçalo',       'NITEROI': 'Niterói',
    'NOVA IGUACU': 'Nova Iguaçu',       'MARICA': 'Maricá',
    'ITABORAI': 'Itaboraí',             'MACAE': 'Macaé',
    'NILOPOLIS': 'Nilópolis',           'TERESOPOLIS': 'Teresópolis',
    'ITAGUAI': 'Itaguaí',               'SAO JOAO DE MERITI': 'São João de Meriti',
    'ANGRA DOS REIS': 'Angra dos Reis', 'CAMPOS DOS GOYTACAZES': 'Campos dos Goytacazes',
    'RIO DE JANEIRO': 'Rio de Janeiro', 'DUQUE DE CAXIAS': 'Duque de Caxias',
    'VOLTA REDONDA': 'Volta Redonda',   'SAO PEDRO DA ALDEIA': 'São Pedro da Aldeia',
    'ARARUAMA': 'Araruama',             'SAQUAREMA': 'Saquarema',
    'RIO BONITO': 'Rio Bonito',         'CABO FRIO': 'Cabo Frio',
    'RIO DAS OSTRAS': 'Rio das Ostras', 'BARRA MANSA': 'Barra Mansa',
    'MESQUITA': 'Mesquita',             'BOM JARDIM': 'Bom Jardim',
    'ARMACAO DOS BUZIOS': 'Armação dos Búzios',
}
```

Faça o mesmo para **bairro** (170 distintos) — sem tabela oficial, use Title Case a
partir da chave normalizada e deixe o usuário corrigir.

### 4. CEP — formatar e validar

```python
def normalizar_cep(bruto):
    d = re.sub(r'\D', '', str(bruto or ''))
    if len(d) != 8:
        return None            # inválido: null, e registre no relatório
    return f'{d[:5]}-{d[5:]}'
```

Todos os 328 têm 8 dígitos. **O CEP é a base da geocodificação** — trate como campo
crítico e valide sempre.

### 5. E-mail

10 registros vazios (às vezes com espaços). `strip()`, minúscula, `None` se vazio.
Valide o formato, mas **não descarte** e-mail malformado — sinalize para correção manual.

### 6. Endereço — o que não dá para consertar

`Logradouro` **não tem número**. Vem como `"AVENIDA. EXEMPLO"`, `"RUA. JOSE AURELIO"`,
`"EST DA POSSE"`, `"R MEXICO"`.

Limpe os prefixos para exibição (`RUA.` → `Rua`, `AVENIDA.` → `Avenida`, `EST` →
`Estrada`, `R ` → `Rua`, `ROD` → `Rodovia`), mas **aceite que a precisão é de rua**.
Não tente adivinhar número. O mapa vai apontar para a via/CEP, não para a porta — o que
é suficiente para roteirizar, e é honesto quanto ao que se sabe.

### 7. Matriz e filial

Mesma razão social com códigos diferentes:
- `FRIOTEC PECAS E SERVICOS LTDA` — 20901, 20880, 20905
- `SUL FLUMINENSE REFRIGERACAO LTDA` — 20954, 21062, 21008, 28901
- `LITORAL REFRIGERACAO` — 5 unidades (Itaboraí, Araruama, Rio Bonito, Saquarema)

São **endereços distintos**, ou seja, pontos distintos no mapa e visitas distintas.
Mantenha como clientes independentes, mas gere um campo `grupoEconomico` (nome
normalizado) para permitir agrupar na interface. Uma visita pode render pedido para
várias unidades — é informação comercial valiosa, não ruído.

## Relatório de importação (obrigatório)

Toda importação emite um relatório. Sem ele, você não sabe o que perdeu:

```
=== IMPORTAÇÃO DE CLIENTES — 27/07/2026 14:32 ===
Lidos:            328  (300 inativos + 28 recuperação)
Importados:       328
Códigos duplicados entre arquivos: 0  ✅

Normalizações:
  Nomes com sufixo [código] removido   328
  Telefones reformatados               297
  Cidades unificadas por acento         18   (SAO GONCALO -> São Gonçalo: 3, ...)
  CEPs formatados                      328

Campos ausentes:
  Contato        328  (100% — coluna vazia na origem)
  E-mail          10
  Telefone         2

Alertas:
  ⚠️ Coluna "Representante" descartada (valor único)
  ⚠️ 14 grupos econômicos com mais de uma unidade

Geocodificação: ver relatório separado.
```

## Enriquecimentos que valem a pena

Campos que a origem não tem e que transformam a utilidade da carteira:

| Campo | Como obter | Valor |
|---|---|---|
| `geo` (lat/lng) | Geocodificação por CEP — ver `05` | 🔴 Habilita todo o mapa |
| `contato` (nome) | **Digitado pelo usuário** no portal | 🔴 Vender é para pessoas, não para CNPJs |
| `ultimaVisita` | Gerado pela agenda | 🔴 "Quem não vejo há 90 dias?" |
| `ultimaCompra` | Precisa vir da Sigma (pendência) | 🔴 Define "inativo" de verdade |
| `grupoEconomico` | Derivado do nome normalizado | 🟡 Agrupa matriz/filial |
| `regiao` | Derivado do bairro/cidade | 🟡 Base do roteiro |
| `notas` | Digitado pelo usuário | 🟡 Memória entre visitas |
| `whatsapp` | Derivado do telefone (11 dígitos) | 🟡 Contato em 1 clique |

Os campos digitados pelo usuário (`contato`, `notas`) **não voltam para o Excel** —
vivem no Supabase (ver `10`). É assim que a carteira deixa de ser
uma foto morta e vira um sistema vivo.
