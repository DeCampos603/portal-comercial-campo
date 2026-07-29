#!/usr/bin/env python3
"""
Geocodifica os clientes por CEP e grava as coordenadas em clientes.json.

Roda UMA vez, no computador — nunca no navegador. O Nominatim limita a 1 requisição
por segundo e proíbe uso em massa pelo cliente (ver conhecimento/05).

O cache é gravado a cada resultado: se cair na metade, nada do que já foi feito se perde.

Uso:
    python geocodificar.py dados/privado/clientes.json --cache cache/geocode.json
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    raise SystemExit("Falta a biblioteca requests.  Instale com:  pip install requests")

for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ⚠️ Obrigatório pela política de uso do Nominatim: identifique a aplicação
#    e um contato real. Requisição sem User-Agent válido é recusada.
#
# Vem do .env (NOMINATIM_CONTATO) para não deixar e-mail pessoal no repositório.
CONTATO = os.environ.get("NOMINATIM_CONTATO", "").strip()
CABECALHOS = {"User-Agent": f"PortalComercialCampo/1.0 ({CONTATO})"}

URL_NOMINATIM = "https://nominatim.openstreetmap.org/search"
PAUSA_SEGUNDOS = 1.1          # o limite é 1 req/s — a folga evita bloqueio

# ---------------------------------------------------------------------
# 🔴 Caixas delimitadoras por UF — a trava contra o erro mais perigoso
#    deste script.
#
# Busca em texto livre com limit=1 SEMPRE devolve algo: se o Nominatim
# não acha "Rua Exemplo, Duque de Caxias, RJ", ele devolve uma
# rua de nome parecido em outro estado, sem avisar. Numa primeira versão
# deste script, 63 dos 317 clientes do RJ (20%) foram parar em PR, MT e
# RS — e o relatório dizia "100% precisão de rua".
#
# Por isso: toda consulta é restrita à caixa da UF (viewbox + bounded=1)
# E o resultado é validado contra a caixa antes de ser aceito.
#
# Formato: (lat_min, lat_max, lon_min, lon_max), com folga nas divisas.
# ---------------------------------------------------------------------
CAIXAS_UF = {
    "RJ": (-23.45, -20.70, -44.95, -40.90),
    "ES": (-21.40, -17.80, -42.00, -38.60),
    "MG": (-23.05, -14.15, -51.15, -39.80),
    "RS": (-33.85, -26.95, -57.75, -49.60),
    "SP": (-25.40, -19.70, -53.20, -44.10),
    "PR": (-26.80, -22.40, -54.70, -47.95),
    "SC": (-29.45, -25.85, -53.90, -48.25),
    "BA": (-18.45, -8.45, -46.70, -37.25),
    "GO": (-19.55, -12.35, -53.30, -45.55),
    "DF": (-16.10, -15.45, -48.30, -47.30),
}


def caixa_da_uf(uf):
    return CAIXAS_UF.get((uf or "").strip().upper())


def dentro_da_caixa(lat, lng, caixa):
    if not caixa:
        return True                     # UF desconhecida: não dá para validar
    lat_min, lat_max, lon_min, lon_max = caixa
    return lat_min <= lat <= lat_max and lon_min <= lng <= lon_max


def carregar_cache(caminho: Path) -> dict:
    if caminho.exists():
        return json.loads(caminho.read_text(encoding="utf-8"))
    return {}


def gravar_cache(caminho: Path, cache: dict) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def consultar_nominatim(parametros: dict, caixa=None):
    """
    Uma consulta ao Nominatim, respeitando o limite de 1 req/s.
    Devolve (lat, lng) ou None. Rejeita resultado fora da caixa da UF.
    """
    parametros = {**parametros, "format": "json", "limit": 1,
                  "countrycodes": "br", "addressdetails": 0}
    if caixa:
        lat_min, lat_max, lon_min, lon_max = caixa
        # viewbox = <lon_esq>,<lat_topo>,<lon_dir>,<lat_base>
        parametros["viewbox"] = f"{lon_min},{lat_max},{lon_max},{lat_min}"
        parametros["bounded"] = 1       # não devolve NADA fora da caixa

    try:
        resposta = requests.get(URL_NOMINATIM, params=parametros,
                                headers=CABECALHOS, timeout=20)
        time.sleep(PAUSA_SEGUNDOS)      # a pausa é parte do contrato de uso
        if resposta.status_code != 200:
            print(f"    Nominatim respondeu {resposta.status_code}")
            return None
        dados = resposta.json()
        if not dados:
            return None
        lat, lng = float(dados[0]["lat"]), float(dados[0]["lon"])
        # Cinto e suspensório: o bounded=1 já deveria bastar.
        if not dentro_da_caixa(lat, lng, caixa):
            return None
        return lat, lng
    except (requests.RequestException, ValueError, KeyError) as erro:
        print(f"    Falha na consulta: {erro}")
        return None


def obter_caixa_cidade(cidade, uf, cache_cidades):
    """
    Caixa delimitadora do MUNICÍPIO, vinda do próprio Nominatim.

    A caixa da UF não basta: o estado do RJ tem várias "Rua da Conceição",
    e restringir só ao estado ainda deixa o endereço do Centro cair em
    Campos. A fronteira municipal é exata e o Nominatim já a devolve em
    `boundingbox` — melhor que chutar um raio.
    """
    chave = f"{cidade}|{uf}"
    if chave in cache_cidades:
        valor = cache_cidades[chave]
        return tuple(valor) if valor else None

    caixa = None
    try:
        resposta = requests.get(
            URL_NOMINATIM,
            params={"city": cidade, "state": uf, "country": "br",
                    "format": "json", "limit": 1},
            headers=CABECALHOS, timeout=20,
        )
        time.sleep(PAUSA_SEGUNDOS)
        if resposta.status_code == 200 and resposta.json():
            bb = resposta.json()[0].get("boundingbox")
            if bb and len(bb) == 4:
                # Nominatim: [lat_min, lat_max, lon_min, lon_max]
                lat_min, lat_max, lon_min, lon_max = (float(v) for v in bb)
                folga = 0.02          # ~2 km, para endereço na divisa
                caixa = (lat_min - folga, lat_max + folga,
                         lon_min - folga, lon_max + folga)
    except (requests.RequestException, ValueError, KeyError) as erro:
        print(f"    Falha ao delimitar {cidade}/{uf}: {erro}")

    cache_cidades[chave] = list(caixa) if caixa else None
    return caixa


def geocodificar_cliente(cliente: dict, cache_cidades: dict):
    """
    Cascata do mais preciso ao mais grosseiro.
    Devolve {'lat','lng','precisao','fonte'} ou None.

    Toda etapa é restrita à caixa do MUNICÍPIO (ou, na falta dela, à da UF).
    Se o endereço não existir dentro da cidade, o resultado é None — NUNCA
    uma rua de mesmo nome noutra cidade. Melhor cliente sem pino do que
    pino no lugar errado.
    """
    endereco = cliente["endereco"]
    cep = endereco.get("cep")
    cidade, uf = endereco.get("cidade"), endereco.get("uf")
    bairro, logradouro = endereco.get("bairro"), endereco.get("logradouro")

    caixa = None
    if cidade and uf:
        caixa = obter_caixa_cidade(cidade, uf, cache_cidades)
    if not caixa:
        caixa = caixa_da_uf(uf)

    # 1. CEP — o identificador mais confiável do Brasil.
    #    Ele aponta um trecho de rua específico, então não sofre com nomes
    #    repetidos entre bairros. "Rua da Conceição" existe no Centro e em
    #    Campo Grande; o CEP 20010-000 é só um lugar.
    #    Medido nesta base: por nome de rua, um endereço do Centro caiu a
    #    46,6 km; pelo CEP, a 2,0 km.
    if cep:
        alvo = consultar_nominatim({"postalcode": cep}, caixa)
        if alvo:
            return {"lat": alvo[0], "lng": alvo[1],
                    "precisao": "rua", "fonte": "nominatim-cep"}

    # 2. Busca ESTRUTURADA: rua + cidade + estado.
    #    Cada campo casa no nível certo da hierarquia, em vez de virar uma
    #    sopa de palavras como no texto livre.
    if logradouro and cidade:
        alvo = consultar_nominatim(
            {"street": logradouro, "city": cidade, "state": uf}, caixa)
        if alvo:
            return {"lat": alvo[0], "lng": alvo[1],
                    "precisao": "rua", "fonte": "nominatim-estruturado"}

    # 3. Centroide do bairro
    if bairro and cidade:
        alvo = consultar_nominatim(
            {"q": f"{bairro}, {cidade}, {uf}, Brasil"}, caixa)
        if alvo:
            return {"lat": alvo[0], "lng": alvo[1],
                    "precisao": "bairro", "fonte": "nominatim"}

    # 4. Centroide da cidade — último recurso
    if cidade:
        alvo = consultar_nominatim({"city": cidade, "state": uf}, caixa)
        if alvo:
            return {"lat": alvo[0], "lng": alvo[1],
                    "precisao": "cidade", "fonte": "nominatim"}

    return None


def carregar_env():
    """Lê o .env da raiz — mesmo formato usado pelos outros scripts."""
    caminho = Path(__file__).resolve().parent.parent / ".env"
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def main():
    parser = argparse.ArgumentParser(description="Geocodifica os clientes por endereço/CEP.")
    parser.add_argument("clientes", type=Path)
    parser.add_argument("--cache", type=Path, default=Path("cache/geocode.json"))
    parser.add_argument("--refazer", action="store_true",
                        help="Ignora o cache e refaz tudo (demorado).")
    args = parser.parse_args()

    if "[[CONFIRMAR" in CONTATO:
        print("⚠️  Defina um e-mail de contato real em CONTATO antes de rodar.")
        print("    O Nominatim recusa requisições sem User-Agent identificável.\n")
        return 1

    if not args.clientes.exists():
        raise SystemExit(f"Arquivo não encontrado: {args.clientes}")

    dados = json.loads(args.clientes.read_text(encoding="utf-8"))
    clientes = dados["clientes"]
    cache = {} if args.refazer else carregar_cache(args.cache)
    caminho_cidades = args.cache.with_name('caixas_cidades.json')
    cache_cidades = {} if args.refazer else carregar_cache(caminho_cidades)

    pendentes = [c for c in clientes if (c["endereco"].get("cep") or "") not in cache]
    print(f"{len(clientes)} clientes · {len(cache)} em cache · {len(pendentes)} a consultar")
    if pendentes:
        print(f"Tempo estimado: ~{len(pendentes) * PAUSA_SEGUNDOS * 2 / 60:.0f} min\n")

    for indice, cliente in enumerate(clientes, 1):
        cep = cliente["endereco"].get("cep")
        if not cep:
            cliente["geo"] = None
            continue

        if cep in cache:
            cliente["geo"] = cache[cep]
            continue

        print(f"[{indice}/{len(clientes)}] {(cliente['nome'] or '?')[:45]}")
        resultado = geocodificar_cliente(cliente, cache_cidades)
        cache[cep] = resultado
        cliente["geo"] = resultado

        # Grava a cada resultado: interromper no meio não descarta o trabalho feito.
        gravar_cache(args.cache, cache)
        gravar_cache(caminho_cidades, cache_cidades)

        if resultado:
            print(f"    ✅ {resultado['precisao']}  "
                  f"{resultado['lat']:.4f}, {resultado['lng']:.4f}")
        else:
            print("    ❌ não localizado")

    args.clientes.write_text(
        json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ---- Relatório -------------------------------------------------------
    total = len(clientes)
    def contar(nivel):
        return sum(1 for c in clientes if c["geo"] and c["geo"]["precisao"] == nivel)

    rua, bairro, cidade = contar("rua"), contar("bairro"), contar("cidade")
    sem = sum(1 for c in clientes if not c["geo"])

    print(f"\n{'=' * 58}")
    print("GEOCODIFICAÇÃO")
    print("=" * 58)
    print(f"Rua      {rua:>4}  ({rua / total:.0%})   ✅ roteiro confiável")
    print(f"Bairro   {bairro:>4}  ({bairro / total:.0%})   ⚠️  aproximado")
    print(f"Cidade   {cidade:>4}  ({cidade / total:.0%})   ⚠️  muito aproximado")
    print(f"Falhou   {sem:>4}  ({sem / total:.0%})")

    # ---- Trava final: nenhum pino pode cair fora da UF do cliente ----
    # Sem esta conferência, um erro de geocodificação vira roteiro errado
    # sem ninguém perceber. Já aconteceu: ver comentário em CAIXAS_UF.
    forasteiros = []
    for c in clientes:
        if not c["geo"]:
            continue
        e = c["endereco"]
        caixa = cache_cidades.get(f"{e.get('cidade')}|{e.get('uf')}")
        caixa = tuple(caixa) if caixa else caixa_da_uf(e.get("uf"))
        if not dentro_da_caixa(c["geo"]["lat"], c["geo"]["lng"], caixa):
            forasteiros.append(c)
    print()
    if forasteiros:
        print(f"🔴 {len(forasteiros)} clientes com coordenada FORA do próprio município:")
        for cliente in forasteiros[:10]:
            geo, e = cliente["geo"], cliente["endereco"]
            print(f"   • {cliente['nome'][:34]:<34} {e.get('cidade')}/{e.get('uf')} "
                  f"-> {geo['lat']:.2f},{geo['lng']:.2f}")
        print("   NÃO use estes dados. Investigue antes de carregar.")
    else:
        print("✅ Conferência: todo pino caiu dentro do município do cliente.")

    por_uf = {}
    for cliente in clientes:
        uf = cliente["endereco"].get("uf")
        por_uf[uf] = por_uf.get(uf, 0) + (1 if cliente["geo"] else 0)
    print(f"   Por UF: {por_uf}")

    if sem:
        print("\nSem coordenada (corrigir à mão no portal):")
        for cliente in [c for c in clientes if not c["geo"]][:10]:
            print(f"  • {cliente['codigo']} — {cliente['nome']}")

    print(f"\n✅ Atualizado {args.clientes}")
    print("   ⚠️  Este arquivo contém localização de clientes reais — não versione.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
