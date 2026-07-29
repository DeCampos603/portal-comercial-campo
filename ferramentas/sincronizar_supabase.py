#!/usr/bin/env python3
"""
Sincroniza a tabela de preços (Google Sheets → Supabase).

Roda sozinho pelo GitHub Actions. Como ninguém confere a planilha antes, o script
tem TRAVAS DE SANIDADE e se recusa a sincronizar quando o dado parece errado —
o catálogo anterior continua no ar e a Action falha com aviso.

Variáveis de ambiente:
    SUPABASE_URL                  https://<projeto>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY     chave secret (NUNCA vai para o frontend)
    SHEETS_CSV_URL                CSV publicado da aba 'Precos'

Uso:
    python sincronizar_supabase.py
    python sincronizar_supabase.py --simular      # não grava, só relata
    python sincronizar_supabase.py --forcar       # ignora as travas (use com cuidado)
"""

import argparse
import csv
import io
import os
import re
import sys
from datetime import datetime, timezone, timedelta

try:
    import requests
except ImportError:
    raise SystemExit("Falta a biblioteca requests.  pip install requests")

for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

FUSO_BR = timezone(timedelta(hours=-3))

# Limiares do semáforo — precisam bater com a coluna gerada em 01-schema.sql
SALDO_SEM_ESTOQUE = 6
SALDO_BAIXO = 200

# Travas de sanidade
VARIACAO_MAX_ITENS = 0.20      # 20% a mais ou a menos no total de itens
VARIACAO_MAX_PRECO = 0.50      # 50% no preço de um item
PROPORCAO_MAX_SEM_PRECO = 0.05  # 5% dos itens sem preço

COLUNAS = {
    "codigo_sigma": ["codigo_sigma", "código sigma", "codigo sigma"],
    "codigo_fabricante": ["codigo_fabricante", "code", "código fabricante"],
    "descricao": ["descricao", "descrição", "compatibilidade / descrição"],
    "valor_unitario": ["valor_unitario", "valor unitario", "valor unitário"],
    "ipi": ["ipi"],
    "st": ["st"],
    "categoria": ["categoria"],
    "grupo": ["grupo"],
    "saldo": ["saldo"],
}


def normalizar_cabecalho(nome):
    return re.sub(r"\s+", " ", str(nome or "").strip().lower())


def mapear_colunas(cabecalho):
    """Aceita variações de nome de coluna — a planilha é editada à mão."""
    normalizado = [normalizar_cabecalho(c) for c in cabecalho]
    mapa = {}
    for campo, aceitos in COLUNAS.items():
        for i, coluna in enumerate(normalizado):
            if coluna in aceitos:
                mapa[campo] = i
                break
    faltando = [c for c in ("codigo_sigma", "valor_unitario") if c not in mapa]
    if faltando:
        raise SystemExit(
            f"🔴 Colunas obrigatórias ausentes no CSV: {faltando}\n"
            f"   Cabeçalho recebido: {cabecalho}\n"
            "   A aba 'Precos' mudou de formato — confira antes de sincronizar."
        )
    return mapa


def para_centavos(bruto):
    """Trata 1.234,56 · R$ 8,50 · 85.5 · vazio · #N/A. Devolve None, nunca 0."""
    if bruto is None or not str(bruto).strip():
        return None
    texto = str(bruto).strip()
    if texto.startswith("#"):              # #N/A, #REF!, #VALOR!
        return None
    limpo = re.sub(r"[R$\s ]", "", texto)
    if "," in limpo:                        # formato brasileiro
        limpo = limpo.replace(".", "").replace(",", ".")
    try:
        return round(float(limpo) * 100)
    except ValueError:
        return None


def para_numero(bruto, padrao=None):
    if bruto is None or not str(bruto).strip():
        return padrao
    texto = str(bruto).strip()
    if texto.startswith("#"):
        return padrao
    limpo = texto.replace("%", "").replace(",", ".")
    try:
        valor = float(limpo)
        return valor / 100 if "%" in texto else valor
    except ValueError:
        return padrao


def baixar_csv(url):
    resposta = requests.get(url, timeout=60)
    resposta.raise_for_status()
    resposta.encoding = "utf-8"
    return list(csv.reader(io.StringIO(resposta.text)))


def montar_itens(linhas):
    if not linhas:
        raise SystemExit("🔴 CSV vazio.")
    mapa = mapear_colunas(linhas[0])

    def campo(linha, nome):
        i = mapa.get(nome)
        return linha[i] if i is not None and i < len(linha) else None

    itens, vistos = [], set()
    for linha in linhas[1:]:
        codigo = (campo(linha, "codigo_sigma") or "").strip()
        if not codigo or codigo in vistos:
            continue
        vistos.add(codigo)

        saldo = para_numero(campo(linha, "saldo"))
        itens.append({
            "codigo_sigma": codigo,
            "codigo_fabricante": (campo(linha, "codigo_fabricante") or "").strip() or None,
            "descricao": (campo(linha, "descricao") or "").strip() or None,
            "valor_unitario_centavos": para_centavos(campo(linha, "valor_unitario")),
            "ipi": round(para_numero(campo(linha, "ipi"), 0.0), 4),
            "st": str(campo(linha, "st") or "").strip().lower() == "sim",
            "categoria": (campo(linha, "categoria") or "").strip() or None,
            "grupo": (campo(linha, "grupo") or "").strip() or None,
            "saldo": int(saldo) if saldo is not None else None,
            # status_estoque NÃO é enviado: é coluna gerada pelo banco
        })
    return itens


def buscar_catalogo_atual(url, chave):
    resposta = requests.get(
        f"{url}/rest/v1/catalogo",
        params={"select": "codigo_sigma,valor_unitario_centavos"},
        headers={"apikey": chave, "Authorization": f"Bearer {chave}"},
        timeout=60,
    )
    resposta.raise_for_status()
    return {i["codigo_sigma"]: i["valor_unitario_centavos"] for i in resposta.json()}


def conferir_sanidade(novos, atuais):
    """Devolve (bloqueios, avisos). Bloqueio impede a sincronização."""
    bloqueios, avisos = [], []

    if not novos:
        bloqueios.append("Catálogo novo está vazio.")
        return bloqueios, avisos

    if atuais:
        variacao = (len(novos) - len(atuais)) / len(atuais)
        if abs(variacao) > VARIACAO_MAX_ITENS:
            bloqueios.append(
                f"Quantidade de itens variou {variacao:+.0%} "
                f"({len(atuais)} → {len(novos)}). Limite: ±{VARIACAO_MAX_ITENS:.0%}."
            )

    sem_preco = [i for i in novos if i["valor_unitario_centavos"] is None]
    if len(sem_preco) / len(novos) > PROPORCAO_MAX_SEM_PRECO:
        bloqueios.append(
            f"{len(sem_preco)} de {len(novos)} itens sem preço "
            f"({len(sem_preco) / len(novos):.0%}). Limite: {PROPORCAO_MAX_SEM_PRECO:.0%}."
        )

    saltos = []
    for item in novos:
        antigo = atuais.get(item["codigo_sigma"])
        novo = item["valor_unitario_centavos"]
        if antigo and novo:
            variacao = (novo - antigo) / antigo
            if abs(variacao) > VARIACAO_MAX_PRECO:
                saltos.append((item["codigo_sigma"], antigo, novo, variacao))
    if saltos:
        bloqueios.append(f"{len(saltos)} itens com salto de preço acima de "
                         f"{VARIACAO_MAX_PRECO:.0%}:")
        for codigo, antigo, novo, variacao in saltos[:8]:
            bloqueios.append(f"    {codigo}: R$ {antigo/100:.2f} → "
                             f"R$ {novo/100:.2f} ({variacao:+.0%})")

    sumidos = set(atuais) - {i["codigo_sigma"] for i in novos}
    if sumidos:
        avisos.append(f"{len(sumidos)} itens sumiram da planilha: "
                      f"{', '.join(sorted(sumidos)[:5])}")
    entraram = {i["codigo_sigma"] for i in novos} - set(atuais)
    if entraram:
        avisos.append(f"{len(entraram)} itens novos: {', '.join(sorted(entraram)[:5])}")

    return bloqueios, avisos


def enviar(url, chave, itens, lote=500):
    """Upsert em lotes, com merge por chave primária (codigo_sigma)."""
    cabecalhos = {
        "apikey": chave,
        "Authorization": f"Bearer {chave}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    agora = datetime.now(FUSO_BR).isoformat(timespec="seconds")
    for item in itens:
        item["atualizado_em"] = agora

    for inicio in range(0, len(itens), lote):
        fatia = itens[inicio:inicio + lote]
        resposta = requests.post(
            f"{url}/rest/v1/catalogo?on_conflict=codigo_sigma",
            headers=cabecalhos, json=fatia, timeout=120,
        )
        if resposta.status_code >= 300:
            raise SystemExit(f"🔴 Supabase recusou o lote "
                             f"{inicio // lote + 1}: {resposta.status_code} {resposta.text[:400]}")
        print(f"   lote {inicio // lote + 1}: {len(fatia)} itens ✅")


def main():
    parser = argparse.ArgumentParser(description="Sincroniza preços do Sheets para o Supabase.")
    parser.add_argument("--simular", action="store_true", help="Não grava; só relata.")
    parser.add_argument("--forcar", action="store_true", help="Ignora as travas de sanidade.")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    csv_url = os.environ.get("SHEETS_CSV_URL")
    if not all([url, chave, csv_url]):
        raise SystemExit("🔴 Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SHEETS_CSV_URL.")

    agora = datetime.now(FUSO_BR)
    print(f"SINCRONIZAÇÃO — {agora:%d/%m/%Y %H:%M}")
    print(f"{'=' * 58}")

    print("Baixando CSV do Google Sheets…")
    itens = montar_itens(baixar_csv(csv_url))
    print(f"   {len(itens)} itens lidos")

    print("Lendo catálogo atual do Supabase…")
    atuais = buscar_catalogo_atual(url, chave)
    print(f"   {len(atuais)} itens no banco")

    bloqueios, avisos = conferir_sanidade(itens, atuais)

    sem_estoque = sum(1 for i in itens
                      if i["saldo"] is not None and i["saldo"] < SALDO_SEM_ESTOQUE)
    baixo = sum(1 for i in itens
                if i["saldo"] is not None and SALDO_SEM_ESTOQUE <= i["saldo"] < SALDO_BAIXO)
    print(f"\n🚦 Estoque: 🔴 {sem_estoque} sem · 🟡 {baixo} baixo · "
          f"🟢 {len(itens) - sem_estoque - baixo} ok")

    if avisos:
        print("\nAvisos:")
        for aviso in avisos:
            print(f"  • {aviso}")

    if bloqueios:
        print(f"\n{'=' * 58}")
        print("🔴 SINCRONIZAÇÃO BLOQUEADA")
        print("=" * 58)
        for bloqueio in bloqueios:
            print(f"  {bloqueio}")
        if not args.forcar:
            print("\nO catálogo anterior CONTINUA no ar — nada foi alterado.")
            print("Confira a planilha. Se os números estiverem certos mesmo,")
            print("rode de novo com --forcar.")
            return 1
        print("\n⚠️  --forcar informado: seguindo apesar dos bloqueios.")

    if args.simular:
        print("\n(simulação — nada foi gravado)")
        return 0

    print(f"\nEnviando {len(itens)} itens…")
    enviar(url, chave, itens)
    print(f"\n✅ Catálogo sincronizado — {agora:%d/%m/%Y %H:%M}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
