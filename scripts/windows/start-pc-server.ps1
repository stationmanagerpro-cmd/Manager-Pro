# Station Manager Pro — démarrage du serveur sur le PC
# Par défaut le serveur n'écoute que sur 127.0.0.1 (le PC lui-même et un proxy local comme Tailscale Serve).
# Option -Lan : écoute sur toutes les interfaces pour que les autres postes du réseau local se connectent
# directement (http://adresse-du-PC:3000). Configurez alors le pare-feu Windows pour le réseau privé uniquement.
# Les mises à jour de la base (migrations) sont appliquées automatiquement avant le démarrage, avec sauvegarde préalable.
# Option -SkipMigrate : démarre sans appliquer les migrations (déconseillé après une mise à jour).
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-pc-server.ps1 [-Lan] [-SkipMigrate]
param(
    [switch]$Lan,
    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

function Read-EnvValue([string]$Name, [string]$Default = '') {
    $envFile = Join-Path $root '.env'
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
            if ($line -match '^\s*#') { continue }
            if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)$')) {
                $v = $Matches[1].Trim()
                if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
                    $v = $v.Substring(1, $v.Length - 2)
                }
                return $v
            }
        }
    }
    $fromEnv = [Environment]::GetEnvironmentVariable($Name)
    if ($fromEnv) { return $fromEnv }
    return $Default
}

function Resolve-Dir([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return [System.IO.Path]::GetFullPath((Join-Path $root $Path))
}

if (-not (Test-Path (Join-Path $root '.env'))) { throw 'Fichier .env absent : copiez .env.pc.example vers .env et renseignez-le.' }
if (-not (Test-Path (Join-Path $root 'node_modules'))) { throw 'Dépendances absentes : lancez scripts\windows\install-local-server.ps1' }

if (-not $SkipMigrate) {
    Write-Host 'Mise à jour de la base (migrations) avant démarrage...' -ForegroundColor Cyan
    & npm run migrate
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'La mise à jour de la base a échoué : le serveur n''est pas démarré pour éviter des erreurs. Corrigez le problème affiché ci-dessus (souvent : pg_dump introuvable ou base inaccessible) puis relancez. -SkipMigrate permet de démarrer malgré tout.' -ForegroundColor Red
        exit 1
    }
}

$env:HOST = '127.0.0.1'
if ($Lan) {
    $env:HOST = '0.0.0.0'
    Write-Host 'Mode réseau local : le serveur écoute sur toutes les interfaces. Ne jamais ouvrir ce port sur le routeur / Internet.' -ForegroundColor Yellow
}
$port = Read-EnvValue 'PORT' '3000'

Write-Host ('Station Manager Pro — démarrage (HOST=' + $env:HOST + ', PORT=' + $port + ')') -ForegroundColor Cyan
Write-Host ('Contrôle : http://127.0.0.1:' + $port + '/api/health')
Write-Host 'Arrêt : Ctrl+C dans cette fenêtre.'

& npm start
if ($LASTEXITCODE -ne 0) {
    Write-Host "Le serveur s'est arrêté avec le code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
