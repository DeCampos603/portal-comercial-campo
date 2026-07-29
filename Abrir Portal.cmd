@echo off
REM ============================================================
REM  Portal Comercial de Campo — atalho para abrir no computador
REM
REM  Basta dar DOIS CLIQUES neste arquivo.
REM
REM  Por que existe: o portal precisa ser servido por um servidor.
REM  Abrir o index.html direto (dois cliques no arquivo) faz o
REM  navegador bloquear o JavaScript por seguranca, e a tela fica
REM  em branco. Este atalho sobe o servidor e abre o endereco certo.
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo   Portal Comercial de Campo
echo   =========================
echo.

REM Procura o Python (py e o lancador padrao do Windows)
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )

if not defined PY (
  echo   [ERRO] Python nao encontrado neste computador.
  echo.
  echo   Instale em https://python.org/downloads
  echo   Na instalacao, marque "Add Python to PATH".
  echo.
  pause
  exit /b 1
)

echo   Subindo o servidor na porta 8123...
echo.
echo   Abra:  http://localhost:8123
echo.
echo   Para PARAR o portal: feche esta janela preta.
echo.

REM Abre o navegador com um pequeno atraso, para o servidor ficar pronto
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8123"

REM O servidor segura esta janela aberta enquanto estiver rodando
%PY% -m http.server 8123 --directory portal

echo.
echo   Servidor encerrado.
pause
