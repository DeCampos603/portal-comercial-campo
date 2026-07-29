#!/usr/bin/env python3
"""
Testa o RLS como se fosse um atacante.

🔴 O RLS é a ÚNICA fronteira de segurança do portal. A chave publishable fica
   exposta no JavaScript por design — se a política estiver errada, qualquer
   pessoa baixa a carteira de clientes e a tabela de preços com os saldos.

Rode antes de publicar, e sempre que mexer nas políticas.

Credenciais no .env (veja modelos/.env.exemplo).
Opcional: TOKEN_ESTRANHO = JWT de uma conta de teste FORA da allowlist.
          É o teste mais importante — veja as instruções no fim da saída.

Uso:
    python ferramentas/testar_rls.py
"""

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
TABELAS = ["catalogo", "clientes", "visitas", "representantes"]


def carregar_env():
    caminho = RAIZ / ".env"
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def consultar(url, tabela, apikey, token=None):
    """Devolve (quantidade_de_linhas, descrição). Quantidade -1 = bloqueado."""
    cabecalhos = {"apikey": apikey, "Authorization": f"Bearer {token or apikey}"}
    try:
        resposta = requests.get(
            f"{url}/rest/v1/{tabela}", params={"select": "*", "limit": "5"},
            headers=cabecalhos, timeout=30,
        )
    except requests.RequestException as erro:
        return -1, f"erro de rede: {erro}"

    if resposta.status_code in (401, 403):
        return -1, f"bloqueado ({resposta.status_code})"
    if resposta.status_code >= 300:
        return -1, f"HTTP {resposta.status_code}: {resposta.text[:120]}"
    try:
        return len(resposta.json()), "ok"
    except ValueError:
        return -1, "resposta não-JSON"


def criar_atacante(url, secret, publishable):
    """
    Cria uma conta de teste, faz login e devolve (token, user_id).

    Automatiza o teste mais importante: uma conta autenticada mas FORA da
    allowlist. Sem isso, o teste dependia de o usuário abrir o console do
    navegador — e teste que dá trabalho não é rodado.

    A conta é apagada em `remover_atacante` no fim.
    """
    email = "rls-teste-temporario@exemplo.invalid"
    senha = "T3ste-RLS-Temporario!2026"
    admin = {"apikey": secret, "Authorization": f"Bearer {secret}",
             "Content-Type": "application/json"}

    # Se sobrou de uma execução anterior, remove antes de recriar.
    try:
        lista = requests.get(f"{url}/auth/v1/admin/users", headers=admin, timeout=30)
        for u in (lista.json().get("users", []) if lista.status_code < 300 else []):
            if u.get("email") == email:
                requests.delete(f"{url}/auth/v1/admin/users/{u['id']}",
                                headers=admin, timeout=30)
    except (requests.RequestException, ValueError):
        pass

    criacao = requests.post(
        f"{url}/auth/v1/admin/users", headers=admin,
        json={"email": email, "password": senha, "email_confirm": True},
        timeout=30,
    )
    if criacao.status_code >= 300:
        return None, None, f"não consegui criar a conta de teste: {criacao.text[:150]}"
    user_id = criacao.json().get("id")

    login = requests.post(
        f"{url}/auth/v1/token", params={"grant_type": "password"},
        headers={"apikey": publishable, "Content-Type": "application/json"},
        json={"email": email, "password": senha}, timeout=30,
    )
    if login.status_code >= 300:
        return None, user_id, f"não consegui logar com a conta de teste: {login.text[:150]}"

    return login.json().get("access_token"), user_id, None


def remover_atacante(url, secret, user_id):
    if not user_id:
        return
    admin = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    try:
        requests.delete(f"{url}/auth/v1/admin/users/{user_id}", headers=admin, timeout=30)
    except requests.RequestException:
        print("   ⚠️  Não consegui apagar a conta de teste. "
              "Remova à mão em Authentication → Users.")


def main():
    carregar_env()
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    publishable = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    token_estranho = os.environ.get("TOKEN_ESTRANHO")
    atacante_id = None

    if not url or not publishable:
        raise SystemExit(
            "🔴 Falta SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY no .env.\n"
            "   (a chave publishable é a 'anon' — a pública, não a secret)"
        )

    print("=" * 62)
    print("TESTE DE RLS — simulando um atacante")
    print("=" * 62)
    print(f"Projeto: {url}\n")

    falhas = []

    # ---- Teste 1: sem login nenhum (só a chave pública) ------------------
    print("TESTE 1 — Visitante sem login (só a chave publishable)")
    print("          Esperado: 0 linhas em TODAS as tabelas")
    for tabela in TABELAS:
        n, obs = consultar(url, tabela, publishable)
        if n > 0:
            print(f"   🔴 {tabela:<16} VAZOU {n} linhas!")
            falhas.append(f"{tabela} exposta sem autenticação")
        elif n == 0:
            print(f"   ✅ {tabela:<16} 0 linhas")
        else:
            print(f"   ✅ {tabela:<16} {obs}")

    # ---- Teste 2: autenticado, mas fora da allowlist ---------------------
    print("\nTESTE 2 — Conta válida, FORA da allowlist")
    print("          Esperado: 0 linhas, inclusive no catálogo")
    # Sem token informado, o próprio script cria a conta atacante.
    if not token_estranho and secret:
        print("   (criando conta de teste temporária…)")
        token_estranho, atacante_id, erro = criar_atacante(url, secret, publishable)
        if erro:
            print(f"   ⚠️  {erro}")

    if not token_estranho:
        print("   ⏭️  PULADO — sem token e sem SUPABASE_SERVICE_ROLE_KEY no .env")
        print()
        print("   ⚠️  Este é o teste MAIS IMPORTANTE: pega a policy `using (true)`,")
        print("      que libera os dados para qualquer conta autenticada.")
        print("      Preencha SUPABASE_SERVICE_ROLE_KEY no .env e rode de novo —")
        print("      o script cria e apaga a conta de teste sozinho.")
        falhas.append("Teste 2 não executado")
    else:
        for tabela in TABELAS:
            n, obs = consultar(url, tabela, publishable, token_estranho)
            if n > 0:
                print(f"   🔴 {tabela:<16} VAZOU {n} linhas para um estranho!")
                falhas.append(f"{tabela} exposta a qualquer conta autenticada")
            elif n == 0:
                print(f"   ✅ {tabela:<16} 0 linhas")
            else:
                print(f"   ✅ {tabela:<16} {obs}")

    # ---- Teste 3: escrita anônima ---------------------------------------
    print("\nTESTE 3 — Escrita sem login")
    print("          Esperado: recusado")
    try:
        resposta = requests.post(
            f"{url}/rest/v1/visitas",
            headers={"apikey": publishable, "Authorization": f"Bearer {publishable}",
                     "Content-Type": "application/json"},
            json={"id": "teste_invasor", "representante_id":
                  "00000000-0000-0000-0000-000000000000", "data": "2026-01-01"},
            timeout=30,
        )
        if resposta.status_code < 300:
            print(f"   🔴 GRAVOU! ({resposta.status_code}) — qualquer um escreve na sua agenda")
            falhas.append("escrita anônima permitida em visitas")
        else:
            print(f"   ✅ recusado ({resposta.status_code})")
    except requests.RequestException as erro:
        print(f"   ⚠️  erro de rede: {erro}")

    # ---- Teste 4: o caminho feliz ----------------------------------------
    # Tão importante quanto os anteriores: um RLS que bloqueia TODO MUNDO
    # passaria nos testes 1 a 3 e ainda assim estaria quebrado. Aqui a mesma
    # conta de teste entra na allowlist e precisa ENXERGAR os dados.
    print("\nTESTE 4 — Representante cadastrado (caminho feliz)")
    print("          Esperado: enxerga catálogo e carteira")
    if not (token_estranho and atacante_id and secret):
        print("   ⏭️  PULADO — depende da conta de teste")
    else:
        admin = {"apikey": secret, "Authorization": f"Bearer {secret}",
                 "Content-Type": "application/json"}
        equipes = requests.get(f"{url}/rest/v1/equipes", params={"select": "id", "limit": "1"},
                               headers=admin, timeout=30).json()
        if not equipes:
            print("   ⚠️  Nenhuma equipe cadastrada — rode o fim de 01-schema.sql")
            falhas.append("Teste 4 não executado (sem equipe)")
        else:
            equipe_id = equipes[0]["id"]
            inclusao = requests.post(
                f"{url}/rest/v1/representantes", headers=admin,
                json={"id": atacante_id, "equipe_id": equipe_id,
                      "nome": "TESTE TEMPORÁRIO", "email": "rls-teste@exemplo.invalid"},
                timeout=30,
            )
            if inclusao.status_code >= 300:
                print(f"   ⚠️  Não consegui cadastrar: {inclusao.text[:120]}")
                falhas.append("Teste 4 não executado")
            else:
                for tabela, esperado in [("catalogo", 5), ("clientes", 5)]:
                    n, obs = consultar(url, tabela, publishable, token_estranho)
                    if n >= esperado:
                        print(f"   ✅ {tabela:<16} enxerga ({n} de amostra)")
                    else:
                        print(f"   🔴 {tabela:<16} NÃO enxerga ({n}) — {obs}")
                        falhas.append(f"representante cadastrado não lê {tabela}")
                requests.delete(f"{url}/rest/v1/representantes",
                                params={"id": f"eq.{atacante_id}"},
                                headers=admin, timeout=30)

    # ---- Limpeza ---------------------------------------------------------
    if atacante_id:
        remover_atacante(url, secret, atacante_id)
        print("\n   (conta de teste removida)")

    # ---- Veredito --------------------------------------------------------
    print("\n" + "=" * 62)
    if falhas:
        print("🔴 NÃO PUBLIQUE — problemas encontrados:")
        for falha in falhas:
            print(f"   • {falha}")
        print("\nRevise modelos/supabase/02-rls.sql e reaplique.")
        print("Confira também Database → Advisors no painel do Supabase.")
        return 1

    print("✅ Todos os testes passaram. RLS está fechando o acesso.")
    print("   Rode também Database → Advisors no painel (tabela sem RLS).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
