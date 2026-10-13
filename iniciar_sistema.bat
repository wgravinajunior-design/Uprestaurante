@echo off
chcp 65001 > nul
title DUSUCO ERP - Painel de Execucao e Testes
color 0F

:MENU
cls
echo ================================================================
echo           DUSUCO ERP - SISTEMA DE CATALOGO E E-COMMERCE        
echo            Firebird 5.0 (3060:DADOS.FDB) + Flutter Web         
echo ================================================================
echo.
echo  [1] Iniciar Sistema Completo (Servidor Electron + 3 Portas)
echo      - Sobe a API REST na porta 8080 (Catalogo Web)
echo      - Sobe a Vitrine de Promocoes na porta 8081 (TV da Loja)
echo      - Sobe o Painel de Pedidos e Fila na porta 8082 (KDS / Senhas)
echo      - Abre a interface de monitoramento Electron
echo.
echo  [2] Iniciar Apenas Servidores Web/TV/Fila (Modo Node.js Leve)
echo      - Sobe o backend Express (Porta 8080, 8081 e 8082)
echo      - Abre o catalogo web no navegador
echo.
echo  [3] Iniciar em Modo Desenvolvimento (Hot-Reload com Flutter Run)
echo      - Inicia o servidor de API
echo      - Executa "flutter run -d chrome" para testes em tempo real
echo.
echo  [4] Abrir Vitrine de Promocoes na TV (http://localhost:8081)
echo.
echo  [5] Abrir Painel de Pedidos e Fila de Senhas (http://localhost:8082)
echo.
echo  [6] Recompilar Flutter Web (Gerar novo build de producao)
echo.
echo  [7] Diagnostico (conexao, colunas e dados do Firebird 5.0)
echo.
echo  [0] Sair
echo ================================================================
set /p OPT="Escolha uma opcao [0-7, Padrao: 1]: "

if "%OPT%"=="" set OPT=1
if "%OPT%"=="1" goto OPCAO_1
if "%OPT%"=="2" goto OPCAO_2
if "%OPT%"=="3" goto OPCAO_3
if "%OPT%"=="4" goto OPCAO_4_TV
if "%OPT%"=="5" goto OPCAO_5_ORDERS
if "%OPT%"=="6" goto OPCAO_6_BUILD
if "%OPT%"=="7" goto OPCAO_7_TEST
if "%OPT%"=="0" goto SAIR
goto MENU

:OPCAO_1
cls
echo ================================================================
echo  Iniciando Servidor Electron e API Firebird 5.0...
echo ================================================================
echo.
cd /d "%~dp0server-electron"
if not exist "node_modules" (
    echo Instalando dependencias do servidor...
    call npm install
)

echo Aguardando inicializacao da API...
start "" cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:8080"
npm start
goto FIM

:OPCAO_2
cls
echo ================================================================
echo  Iniciando Servidor Node.js (API REST + Flutter Web na porta 8080)...
echo ================================================================
echo.
cd /d "%~dp0server-electron"
if not exist "node_modules" (
    echo Instalando dependencias do servidor...
    call npm install
)

echo Abrindo navegador em http://localhost:8080...
start "" cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:8080"
node server/index.js
goto FIM

:OPCAO_3
cls
echo ================================================================
echo  Iniciando em Modo Desenvolvimento (Hot Reload)...
echo ================================================================
echo.
echo [1/2] Iniciando Servidor API REST em segundo plano...
start "DUSUCO API REST" cmd /k "cd /d "%~dp0server-electron" && node server/index.js"

echo [2/2] Iniciando Flutter Web no Chrome...
cd /d "%~dp0flutter_web"
flutter run -d chrome
goto FIM

:OPCAO_4_TV
cls
echo ================================================================
echo  Abrindo Vitrine de Promocoes na TV (http://localhost:8081)...
echo ================================================================
echo.
start http://localhost:8081
echo Link enviado para o navegador padrao!
timeout /t 2 /nobreak > nul
goto MENU

:OPCAO_5_ORDERS
cls
echo ================================================================
echo  Abrindo Painel de Pedidos e Fila de Senhas (http://localhost:8082)...
echo ================================================================
echo.
start http://localhost:8082
echo Link enviado para o navegador padrao!
timeout /t 2 /nobreak > nul
goto MENU

:OPCAO_6_BUILD
cls
echo ================================================================
echo  Recompilando Flutter Web para Producao...
echo ================================================================
echo.
cd /d "%~dp0flutter_web"
call flutter build web --release
if errorlevel 1 (
    echo [ERRO] A compilacao do Flutter falhou. Verifique as mensagens acima.
    pause
    goto MENU
)
echo.
echo ================================================================
echo  Compilacao concluida com sucesso!
echo ================================================================
pause
goto MENU

:OPCAO_7_TEST
cls
echo ================================================================
echo  Testando Conexao com Firebird 5.0 e Consultando Tabelas...
echo ================================================================
echo.
cd /d "%~dp0server-electron"
call node diagnostico.js
echo.
echo ================================================================
echo  Diagnostico finalizado!
echo ================================================================
pause
goto MENU

:SAIR
exit

:FIM
exit
