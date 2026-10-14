param([Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall')][string]$Action)
# Executado ELEVADO (administrador). Cria/remove a tarefa de inicializacao do servidor como SYSTEM.
$ErrorActionPreference = 'Stop'
$TaskName = 'DusucoERP-Servidor'
$ServerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogFile = Join-Path $PSScriptRoot 'service-last.log'
$Launcher = Join-Path $PSScriptRoot 'run-server.cmd'

try {
    if ($Action -eq 'install') {
        $node = (Get-Command node -ErrorAction Stop).Source
        # Launcher .cmd evita aspas aninhadas no /TR do schtasks
        $lines = @('@echo off', "cd /d `"$ServerDir`"", "`"$node`" server\index.js >> service\server.log 2>&1")
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
