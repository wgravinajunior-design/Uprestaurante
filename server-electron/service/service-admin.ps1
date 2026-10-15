param(
    [Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall')][string]$Action,
    [string]$LogFile = '',
    [string]$DataDir = '',
    [string]$AppExe = '',
    [int]$Packaged = 0
)
# Executado ELEVADO (administrador). Cria/remove a tarefa de inicializacao do servidor como SYSTEM.
$ErrorActionPreference = 'Stop'
$TaskName = 'DusucoERP-Servidor'
if (-not $LogFile) { $LogFile = Join-Path $PSScriptRoot 'service-last.log' }

try {
    if ($Action -eq 'install') {
        if ($Packaged -eq 1) {
            # App instalado: usa o proprio executavel como Node (ELECTRON_RUN_AS_NODE) e dados em %APPDATA%
            if (-not (Test-Path $AppExe)) { throw "Executavel nao encontrado: $AppExe" }
            if (-not $DataDir) { throw 'Pasta de dados nao informada' }
            $asar = Join-Path (Split-Path $AppExe) 'resources\app.asar'
            $Launcher = Join-Path $DataDir 'run-server.cmd'
            $lines = @('@echo off',
                'set ELECTRON_RUN_AS_NODE=1',
                "set CONFIG_DIR=$DataDir\config",
                "set CACHE_DIR=$DataDir\cache",
                "cd /d `"$DataDir`"",
                "`"$AppExe`" `"$asar\server\index.js`" >> `"$DataDir\server.log`" 2>&1")
        } else {
            $ServerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
            $node = (Get-Command node -ErrorAction Stop).Source
            $Launcher = Join-Path $PSScriptRoot 'run-server.cmd'
            $lines = @('@echo off', "cd /d `"$ServerDir`"", "`"$node`" server\index.js >> service\server.log 2>&1")
        }
        # Launcher .cmd evita aspas aninhadas no /TR do schtasks
        Set-Content -Path $Launcher -Value $lines -Encoding ASCII
        schtasks.exe /Create /TN $TaskName /TR "`"$Launcher`"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "schtasks /Create falhou (codigo $LASTEXITCODE)" }
        schtasks.exe /Run /TN $TaskName | Out-Null
        'OK: servico instalado e iniciado' | Set-Content $LogFile
    } else {
        schtasks.exe /End /TN $TaskName 2>$null | Out-Null
        schtasks.exe /Delete /TN $TaskName /F | Out-Null
        'OK: servico removido' | Set-Content $LogFile
    }
} catch {
    "ERRO: $($_.Exception.Message)" | Set-Content $LogFile
    exit 1
}
