# Station Manager Pro — vérifications avant démarrage du serveur local
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\preflight-pc-server.ps1
# Lecture seule : ne modifie ni la base ni la configuration (crée seulement les dossiers de données manquants).

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

$ErrorActionPreference = 'Continue'
$script:errors = 0
$script:warnings = 0
function Write-Ok([string]$m)   { Write-Host "[OK]        $m" -ForegroundColor Green }
function Write-Warn([string]$m) { $script:warnings++; Write-Host "[ATTENTION] $m" -ForegroundColor Yellow }
function Write-Fail([string]$m) { $script:errors++;   Write-Host "[ERREUR]    $m" -ForegroundColor Red }

Write-Host 'Station Manager Pro — contrôle avant démarrage' -ForegroundColor Cyan
Write-Host ''

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = (& node -v).Trim()
    $nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
    if ($nodeMajor -ge 18) { Write-Ok "Node.js $nodeVersion" } else { Write-Fail "Node.js $nodeVersion : version 18 ou plus requise" }
} else { Write-Fail 'Node.js introuvable' }
if (Get-Command npm -ErrorAction SilentlyContinue) { Write-Ok 'npm disponible' } else { Write-Fail 'npm introuvable' }

# Dépendances
if (Test-Path (Join-Path $root 'node_modules')) { Write-Ok 'Dépendances installées (node_modules)' }
else { Write-Fail 'node_modules absent : lancez scripts\windows\install-local-server.ps1' }
if (-not (Test-Path (Join-Path $root 'package-lock.json'))) { Write-Warn 'package-lock.json absent : les versions des dépendances ne sont pas figées' }

# Configuration
if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Fail 'Fichier .env absent : copiez .env.pc.example vers .env'
} else {
    Write-Ok 'Fichier .env présent'
    $dbUrl = Read-EnvValue 'DATABASE_URL'
    if (-not $dbUrl) { Write-Fail 'DATABASE_URL est vide' }
    elseif ($dbUrl -match 'REMPLACER|UTILISATEUR|MOT_DE_PASSE') { Write-Fail 'DATABASE_URL contient encore une valeur d''exemple' }
    else {
        Write-Ok 'DATABASE_URL renseignée'
        if ($dbUrl -notmatch '@(127\.0\.0\.1|localhost|\[::1\])[:/]') { Write-Warn 'DATABASE_URL ne vise pas ce PC (127.0.0.1 / localhost)' }
    }
    $jwt = Read-EnvValue 'JWT_SECRET'
    if (-not $jwt -or $jwt.Length -lt 32) { Write-Fail 'JWT_SECRET absent ou de moins de 32 caractères (le serveur refusera de démarrer)' }
    elseif ($jwt -match 'REMPLACER|CHANGEZ') { Write-Fail 'JWT_SECRET est encore la valeur d''exemple' }
    else { Write-Ok 'JWT_SECRET suffisamment long' }
    if ((Read-EnvValue 'NODE_ENV') -ne 'production') { Write-Warn 'NODE_ENV n''est pas "production"' }

    foreach ($flag in 'RESTORE_ENABLED', 'RESTORE_TARGET_ISOLATED', 'RESET_GLOBAL_ENABLED', 'CLIENT_RESTORE_ENABLED', 'CLIENT_RESET_ENABLED', 'PLATFORM_RESTORE_ENABLED') {
        if ((Read-EnvValue $flag '0') -eq '1') { Write-Warn "$flag=1 : opération destructive activée. À remettre à 0 après usage." }
    }

    # Dossiers de données
    foreach ($pair in @(@('UPLOAD_DIR', '.\uploads'), @('BACKUP_DIR', '.\backups'))) {
        $dir = Resolve-Dir (Read-EnvValue $pair[0] $pair[1])
        try {
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $probe = Join-Path $dir ('.ecriture-' + [guid]::NewGuid().ToString('N'))
            Set-Content -LiteralPath $probe -Value 'test' -ErrorAction Stop
            Remove-Item -LiteralPath $probe -Force
            Write-Ok ($pair[0] + ' accessible en écriture : ' + $dir)
            if ($dir.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Warn ($pair[0] + ' est dans le dossier du code : préférez un dossier séparé (ex. D:\StationManagerData)')
            }
        } catch { Write-Fail ($pair[0] + ' inaccessible en écriture : ' + $dir) }
    }
}

# Outils PostgreSQL (sauvegardes)
function Find-PgTool([string]$Name, [string]$EnvName) {
    $custom = Read-EnvValue $EnvName
    if ($custom -and (Test-Path -LiteralPath $custom)) { return $custom }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem -Path 'C:\Program Files\PostgreSQL\*\bin' -Filter ($Name + '.exe') -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}
$pgDump = Find-PgTool 'pg_dump' 'PG_DUMP'
if ($pgDump) { Write-Ok "pg_dump trouvé : $pgDump" } else { Write-Fail 'pg_dump introuvable : les sauvegardes échoueront. Installez les outils clients PostgreSQL ou définissez PG_DUMP dans .env' }
if (Find-PgTool 'psql' 'PSQL') { Write-Ok 'psql trouvé' } else { Write-Warn 'psql introuvable (nécessaire pour restaurer une sauvegarde)' }

# Connexion à la base
if ((Test-Path (Join-Path $root 'node_modules')) -and (Test-Path (Join-Path $root '.env'))) {
    & node (Join-Path $root 'scripts\check-db-connection.js')
    if ($LASTEXITCODE -eq 0) { Write-Ok 'Connexion à la base PostgreSQL' } else { Write-Fail 'Connexion à la base impossible (voir le message ci-dessus)' }
}

# Port
$port = [int](Read-EnvValue 'PORT' '3000')
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) { Write-Warn "Le port $port est déjà utilisé (le serveur est peut-être déjà démarré)" } else { Write-Ok "Port $port libre" }

Write-Host ''
if ($script:errors -gt 0) {
    Write-Host ("Contrôle terminé : $($script:errors) erreur(s), $($script:warnings) avertissement(s). Corrigez les erreurs avant de démarrer.") -ForegroundColor Red
    exit 1
}
Write-Host ("Contrôle terminé : aucune erreur, $($script:warnings) avertissement(s).") -ForegroundColor Green
exit 0
