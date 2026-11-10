# Station Manager Pro — sauvegarde PostgreSQL immédiate
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\backup-now.ps1
# Peut être planifié avec le Planificateur de tâches Windows (voir le guide d'hébergement).

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

$started = Get-Date
Write-Host 'Sauvegarde PostgreSQL en cours (npm run backup)...' -ForegroundColor Cyan
& npm run backup
if ($LASTEXITCODE -ne 0) {
    Write-Host "ÉCHEC de la sauvegarde (code $LASTEXITCODE). Aucune réussite n'est déclarée." -ForegroundColor Red
    exit 1
}

$backupDir = Resolve-Dir (Read-EnvValue 'BACKUP_DIR' '.\backups')
$latest = $null
if (Test-Path -LiteralPath $backupDir) {
    $latest = Get-ChildItem -LiteralPath $backupDir -Filter 'smp-*.sql.gz' -File |
        Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-5) } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $latest -or $latest.Length -le 0) {
    Write-Host "ÉCHEC : la commande s'est terminée sans produire de fichier de sauvegarde récent dans $backupDir." -ForegroundColor Red
    exit 1
}
Write-Host ('Sauvegarde créée : ' + $latest.FullName + ' (' + [math]::Round($latest.Length / 1MB, 2) + ' Mo)') -ForegroundColor Green
Write-Host 'Rappel : copiez aussi cette sauvegarde hors du PC (disque externe chiffré) et testez régulièrement une restauration.'
exit 0
