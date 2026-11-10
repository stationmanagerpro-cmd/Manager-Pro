# Station Manager Pro — installation du serveur local (PC Windows dédié)
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-local-server.ps1
# Ce script prépare le dossier du projet : il ne crée pas, ne migre et ne restaure aucune base.

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

Write-Host 'Station Manager Pro — installation du serveur local' -ForegroundColor Cyan
Write-Host ('Dossier du projet : ' + $root)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js est introuvable. Installez Node.js LTS (https://nodejs.org) puis relancez ce script.'
}
$nodeVersion = (& node -v).Trim()
$nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 18) { throw "Node.js 18 ou plus est requis (version détectée : $nodeVersion)." }
Write-Host "Node.js $nodeVersion détecté."

if (-not (Test-Path '.\.env')) {
    if (Test-Path '.\.env.pc.example') {
        Copy-Item -LiteralPath '.\.env.pc.example' -Destination '.\.env'
        Write-Host 'Fichier de configuration créé à partir du modèle PC.' -ForegroundColor Green
        Write-Host 'À FAIRE : ouvrez le fichier de configuration et remplacez DATABASE_URL (mot de passe PostgreSQL) et JWT_SECRET.' -ForegroundColor Yellow
        Write-Host "Générer un secret : node -e `"console.log(require('crypto').randomBytes(48).toString('hex'))`""
    } else {
        Write-Host 'Modèle de configuration .env.pc.example introuvable : créez le fichier .env manuellement.' -ForegroundColor Yellow
    }
} else {
    Write-Host '.env existe déjà : il ne sera pas remplacé.'
}

Write-Host 'Installation des dépendances...'
if (Test-Path '.\package-lock.json') {
    & npm ci --omit=dev
} else {
    Write-Host 'package-lock.json absent : installation avec npm install (versions non figées).' -ForegroundColor Yellow
    & npm install --omit=dev
}
if ($LASTEXITCODE -ne 0) { throw "L'installation des dépendances a échoué (code $LASTEXITCODE)." }

Write-Host ''
Write-Host 'Installation terminée. Ce script ne crée pas, ne migre et ne restaure aucune base.' -ForegroundColor Green
Write-Host 'Étapes suivantes :'
Write-Host '  1. Créer la base PostgreSQL et le rôle applicatif (voir docs\HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md).'
Write-Host '  2. Renseigner DATABASE_URL et JWT_SECRET dans le fichier de configuration.'
Write-Host '  3. Lancer scripts\windows\preflight-pc-server.ps1'
Write-Host '  4. Sur une base neuve : npm run migrate puis npm run setup -- <login> <motdepasse> "<Nom station>"'
