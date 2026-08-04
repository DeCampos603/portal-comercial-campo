#!/usr/bin/env python3
"""
Sincroniza a tabela de preços (Google Sheets → Supabase).

Roda sozinho pelo GitHub Actions. Como ninguém confere a planilha antes, o script
tem TRAVAS DE SANIDADE e se recusa a sincronizar quando o dado parece errado —
o catálogo anterior continua no ar e a Action falha com aviso.

Variáveis de ambiente:
    SUPABASE_URL                  https://<projeto>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY     chave secret (NUNCA vai para o frontend)

    E UMA das duas origens:
    SHEETS_URL                    link (ou só o ID) da planilha no Google Sheets.
                                  Lê o XLSX no formato original da Sigma.
    SHEETS_CSV_URL                CSV publicado de uma aba 'Precos' já limpa.

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
from pathlib import Path

try:
    import requests
except ImportError:
    raise SystemExit("Falta a biblioteca requests.  pip install requests")

# Reaproveita o parser da carga inicial em vez de escrever um segundo.
# A planilha da Sigma não é uma tabela: é um formulário de pedido com o
# cabeçalho na linha 19, três abas e um catálogo lateral. Manter duas
# implementações disso significaria que a primeira mudança de layout
# consertaria uma e deixaria a outra sincronizando dado errado em silêncio.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from importar_precos import importar as importar_xlsx  # noqa: E402

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


def url_de_exportacao(bruto):
    """Aceita o link de compartilhamento inteiro ou só o ID do documento."""
    texto = str(bruto).strip()
    casa = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", texto)
    identificador = casa.group(1) if casa else texto
    return (f"https://docs.google.com/spreadsheets/d/{identificador}"
            "/export?format=xlsx")


def baixar_xlsx(bruto):
    """
    Baixa a planilha do Google Sheets como XLSX.

    🔴 Planilha sem compartilhamento público devolve HTTP **200** com uma
       página HTML de login. Sem esta conferência, o openpyxl receberia HTML,
       falharia com "File is not a zip file" e ninguém entenderia por quê —
       quando a causa é permissão, não formato.
    """
    url = url_de_exportacao(bruto)
    resposta = requests.get(url, timeout=120)
    resposta.raise_for_status()

    tipo = resposta.headers.get("Content-Type", "")
    if "html" in tipo.lower():
        raise SystemExit(
            "🔴 O Google devolveu uma página HTML, não a planilha.\n"
            "   Quase sempre é permissão: a planilha precisa estar como\n"
            "   'Qualquer pessoa com o link' → Leitor.\n"
            f"   URL usada: {url}"
        )
    if not resposta.content.startswith(b"PK"):
        raise SystemExit(f"🔴 O download não parece um XLSX ({tipo}).")

    return io.BytesIO(resposta.content)


def montar_itens_do_xlsx(conteudo):
    """Traduz o retorno de importar_precos para as colunas do banco."""
    itens, _comissoes, avisos, _lateral = importar_xlsx(conteudo)
    for aviso in avisos[:10]:
        print(f"   ⚠️  {aviso}")
    if len(avisos) > 10:
        print(f"   ⚠️  … e mais {len(avisos) - 10} aviso(s)")

    return [{
        "codigo_sigma": i["codigoSigma"],
        "codigo_fabricante": i["codigoFabricante"],
        "descricao": i["descricao"],
        "valor_unitario_centavos": i["valorUnitarioCentavos"],
        "ipi": i["ipi"],
        "st": i["st"],
        "categoria": i["categoria"],
        "grupo": i["grupo"],
        "saldo": i["saldo"],
        # status_estoque NÃO é enviado: é coluna gerada pelo banco
    } for i in itens]


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
    sheets_url = os.environ.get("SHEETS_URL")
    csv_url = os.environ.get("SHEETS_CSV_URL")

    # Diz QUAL variável falta e ONDE preenchê-la. A mensagem antiga listava as
    # duas juntas — quem via o log da Action não sabia se tinha errado o nome
    # de uma ou esquecido as duas, e a Action não mostra o valor dos segredos
    # para conferir. Rodando no GitHub, a correção é em outro lugar (Settings →
    # Secrets); rodando na máquina, é o .env. Apontar o lugar certo economiza
    # a viagem errada.
    no_github = bool(os.environ.get("GITHUB_ACTIONS"))
    onde = ("Settings → Secrets and variables → Actions → New repository secret"
            if no_github else "o arquivo .env na raiz do projeto")

    faltando = [nome for nome, valor in
                (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", chave))
                if not valor]
    if not (sheets_url or csv_url):
        faltando.append("SHEETS_URL")

    if faltando:
        raise SystemExit(
            f"🔴 Faltando: {', '.join(faltando)}\n"
            f"   Defina em: {onde}\n\n"
            "   SUPABASE_URL                https://<projeto>.supabase.co\n"
            "   SUPABASE_SERVICE_ROLE_KEY   Supabase → Settings → API → service_role\n"
            "   SHEETS_URL                  link de compartilhamento da planilha\n\n"
            "   O nome do segredo precisa bater EXATAMENTE, inclusive maiúsculas."
        )

    agora = datetime.now(FUSO_BR)
    print(f"SINCRONIZAÇÃO — {agora:%d/%m/%Y %H:%M}")
    print(f"{'=' * 58}")

    # SHEETS_URL tem precedência: é a planilha real, no formato original.
    if sheets_url:
        print("Baixando a planilha (XLSX) do Google Sheets…")
        itens = montar_itens_do_xlsx(baixar_xlsx(sheets_url))
    else:
        print("Baixando CSV do Google Sheets…")
        itens = montar_itens(baixar_csv(csv_url))
    print(f"   {len(itens)} itens lidos")

    print("Lendo catálogo atual do Supabase…")
    atuais = buscar_catalogo_atual(url, chave)
    print(f"   {len(atuais)} itens no banco")

    bloqueios, avisos = conferir_sanidade(itens, atuais)

    # Item sem saldo conhecido NÃO é "ok" — é desconhecido. Contar junto
    # inflaria o verde e esconderia exatamente o que precisa de atenção.
    sem_dado = sum(1 for i in itens if i["saldo"] is None)
    sem_estoque = sum(1 for i in itens
                      if i["saldo"] is not None and i["saldo"] < SALDO_SEM_ESTOQUE)
    baixo = sum(1 for i in itens
                if i["saldo"] is not None and SALDO_SEM_ESTOQUE <= i["saldo"] < SALDO_BAIXO)
    ok = len(itens) - sem_estoque - baixo - sem_dado
    print(f"\n🚦 Estoque: 🔴 {sem_estoque} sem · 🟡 {baixo} baixo · "
          f"🟢 {ok} ok · ⬜ {sem_dado} sem dado")

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
