#!/usr/bin/env python3
"""
Carga inicial: envia catalogo.json e clientes.json para o Supabase.

Roda UMA vez, na instalação. Depois disso o catálogo é mantido pela sincronização
automática (sincronizar_supabase.py) e os clientes pelo próprio portal.

As credenciais vêm de um arquivo .env local (nunca commitado). Copie
`modelos/.env.exemplo` para `.env` na raiz do projeto e preencha.

Uso:
    python ferramentas/carga_inicial.py --simular    # confere sem gravar
    python ferramentas/carga_inicial.py
    python ferramentas/carga_inicial.py --so-catalogo
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    raise SystemExit("Falta a biblioteca requests.  pip install requests")

for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

RAIZ = Path(__file__).resolve().parent.parent


def carregar_env():
    """Lê o .env da raiz. Sem biblioteca externa — o formato é trivial."""
    caminho = RAIZ / ".env"
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def exigir(nome):
    valor = os.environ.get(nome)
    if not valor:
        raise SystemExit(
            f"🔴 Falta {nome}.\n"
            f"   Copie modelos/.env.exemplo para .env na raiz do projeto e preencha."
        )
    return valor


def enviar(url, chave, tabela, registros, conflito, lote=500):
    cabecalhos = {
        "apikey": chave,
        "Authorization": f"Bearer {chave}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for inicio in range(0, len(registros), lote):
        fatia = registros[inicio:inicio + lote]
        resposta = requests.post(
            f"{url}/rest/v1/{tabela}?on_conflict={conflito}",
            headers=cabecalhos, json=fatia, timeout=120,
        )
        if resposta.status_code >= 300:
            raise SystemExit(
                f"🔴 Supabase recusou o lote {inicio // lote + 1} de '{tabela}':\n"
                f"   {resposta.status_code} {resposta.text[:500]}"
            )
        print(f"   lote {inicio // lote + 1}: {len(fatia)} registros ✅")


def montar_catalogo(caminho):
    dados = json.loads(caminho.read_text(encoding="utf-8"))
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
        # ⚠️ status_estoque NÃO é enviado: é coluna gerada pelo Postgres.
        #    Mandar geraria erro 400.
    } for i in dados["itens"]]


def montar_clientes(caminho, equipe_id, representante_id):
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    registros = []
    for c in dados["clientes"]:
        endereco = c.get("endereco") or {}
        geo = c.get("geo") or {}
        registros.append({
            # equipe_id controla a VISIBILIDADE (carteira compartilhada);
            # representante_id apenas registra o responsável.
            "equipe_id": equipe_id,
            "representante_id": representante_id,
            "codigo": c["codigo"],
            "nome": c["nome"],
            "origem": c["origem"],
            "status": c.get("status"),
            "contato": c.get("contato"),
            "telefone": c.get("telefone"),
            "whatsapp": c.get("whatsapp"),
            "email": c.get("email"),
            "logradouro": endereco.get("logradouro"),
            "bairro": endereco.get("bairro"),
            "cidade": endereco.get("cidade"),
            "uf": endereco.get("uf"),
            "cep": endereco.get("cep"),
            "lat": geo.get("lat"),
            "lng": geo.get("lng"),
            "geo_precisao": geo.get("precisao"),
            "grupo_economico": c.get("grupoEconomico"),
            "notas": c.get("notas"),
            "ultima_visita": c.get("ultimaVisita"),
        })
    return registros


def conferir_representante(url, chave, representante_id):
    """A linha em `representantes` precisa existir ANTES dos clientes (FK)."""
    resposta = requests.get(
        f"{url}/rest/v1/representantes",
        params={"select": "id,nome,ativo,equipe_id", "id": f"eq.{representante_id}"},
        headers={"apikey": chave, "Authorization": f"Bearer {chave}"},
        timeout=30,
    )
    resposta.raise_for_status()
    linhas = resposta.json()
    if not linhas:
        raise SystemExit(
            f"🔴 Não existe representante com id {representante_id}.\n\n"
            "   Rode antes o bloco final de 01-schema.sql, que cria a equipe\n"
            "   e cadastra os representantes."
        )
    rep = linhas[0]
    if not rep.get("equipe_id"):
        raise SystemExit(
            f"🔴 O representante '{rep['nome']}' está sem equipe.\n\n"
            "   A equipe define quem enxerga a carteira. Rode no SQL Editor:\n\n"
            "   update public.representantes\n"
            "      set equipe_id = (select id from public.equipes limit 1)\n"
            f"    where id = '{representante_id}';"
        )
    return rep


def listar_equipe(url, chave, equipe_id):
    """Quem mais enxerga esta carteira — bom conferir antes de carregar."""
    resposta = requests.get(
        f"{url}/rest/v1/representantes",
        params={"select": "nome,email,ativo", "equipe_id": f"eq.{equipe_id}"},
        headers={"apikey": chave, "Authorization": f"Bearer {chave}"},
        timeout=30,
    )
    resposta.raise_for_status()
    return resposta.json()


def main():
    parser = argparse.ArgumentParser(description="Carga inicial no Supabase.")
    parser.add_argument("--simular", action="store_true", help="Confere sem gravar.")
    parser.add_argument("--so-catalogo", action="store_true")
    parser.add_argument("--so-clientes", action="store_true")
    args = parser.parse_args()

    carregar_env()
    url = exigir("SUPABASE_URL").rstrip("/")
    chave = exigir("SUPABASE_SERVICE_ROLE_KEY")
    representante_id = exigir("REPRESENTANTE_ID")

    catalogo_json = RAIZ / "dados" / "privado" / "catalogo.json"
    clientes_json = RAIZ / "dados" / "privado" / "clientes.json"

    print("=" * 58)
    print("CARGA INICIAL NO SUPABASE")
    print("=" * 58)
    print(f"Projeto: {url}")

    rep = conferir_representante(url, chave, representante_id)
    equipe_id = rep["equipe_id"]
    print(f"Responsável: {rep['nome']} (ativo={rep['ativo']})")
    if not rep["ativo"]:
        print("⚠️  Representante está INATIVO — ele não verá nada no portal.")

    equipe = listar_equipe(url, chave, equipe_id)
    print(f"Carteira compartilhada com {len(equipe)} representante(s):")
    for membro in equipe:
        marca = "" if membro["ativo"] else "  (INATIVO)"
        print(f"   • {membro['nome']} <{membro['email']}>{marca}")

    # ---- Catálogo --------------------------------------------------------
    if not args.so_clientes:
        if not catalogo_json.exists():
            raise SystemExit(f"🔴 Não encontrei {catalogo_json}. Rode importar_precos.py antes.")
        itens = montar_catalogo(catalogo_json)
        # Item sem saldo conhecido NÃO é "ok" — é desconhecido. Contar junto
        # inflaria o verde e esconderia exatamente o que precisa de atenção.
        sem_dado = sum(1 for i in itens if i["saldo"] is None)
        sem_estoque = sum(1 for i in itens if i["saldo"] is not None and i["saldo"] < 6)
        baixo = sum(1 for i in itens if i["saldo"] is not None and 6 <= i["saldo"] < 200)
        ok = len(itens) - sem_estoque - baixo - sem_dado
        print(f"\nCATÁLOGO: {len(itens)} itens")
        print(f"   🚦 🔴 {sem_estoque} sem estoque · 🟡 {baixo} baixo · "
              f"🟢 {ok} ok · ⬜ {sem_dado} sem dado")
        if not args.simular:
            enviar(url, chave, "catalogo", itens, "codigo_sigma")

    # ---- Clientes --------------------------------------------------------
    if not args.so_catalogo:
        if not clientes_json.exists():
            raise SystemExit(f"🔴 Não encontrei {clientes_json}. Rode importar_clientes.py antes.")
        clientes = montar_clientes(clientes_json, equipe_id, representante_id)
        com_geo = sum(1 for c in clientes if c["lat"] is not None)
        print(f"\nCLIENTES: {len(clientes)}")
        print(f"   {com_geo} com coordenada · {len(clientes) - com_geo} sem")
        if com_geo == 0:
            print("   ⚠️  Nenhum cliente geocodificado — o mapa ficará vazio.")
            print("      Rode ferramentas/geocodificar.py e faça a carga de novo")
            print("      (é upsert: pode repetir sem duplicar).")
        if not args.simular:
            enviar(url, chave, "clientes", clientes, "equipe_id,codigo")

    if args.simular:
        print("\n(simulação — nada foi gravado)")
        return 0

    print("\n✅ Carga concluída.")
    print("   Próximo passo: python ferramentas/testar_rls.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
