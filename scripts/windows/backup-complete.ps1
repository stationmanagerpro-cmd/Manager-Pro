# Station Manager Pro — sauvegarde complète : dump PostgreSQL + fichiers téléversés
# Crée une archive .zip vérifiée (manifeste SHA-256) sur un disque externe ou un dossier hors du projet.
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\backup-complete.ps1 -DestinationRoot E:\StationManagerBackups
# Remarque : Compress-Archive (Windows PowerShell 5.1) est limité à environ 2 Go par archive.
param(
    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot
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

$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$destFull = [System.IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\') + '\'
if ($destFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'La destination doit être hors du dossier du projet.'
}
if (-not (Test-Path -LiteralPath $DestinationRoot)) { New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $DestinationRoot ("smp-complete-$stamp.zip")
$tmpBase = [System.IO.Path]::GetTempPath()
$stage = Join-Path $tmpBase ("smp-stage-$stamp")
$verify = Join-Path $tmpBase ("smp-verify-$stamp")
$started = Get-Date
$ok = $false
$exitCode = 0

try {
    Write-Host '1/5 Sauvegarde PostgreSQL (npm run backup)...' -ForegroundColor Cyan
    & npm run backup
    if ($LASTEXITCODE -ne 0) { throw "La sauvegarde PostgreSQL a échoué (code $LASTEXITCODE). Aucune archive créée." }

    $backupDir = Resolve-Dir (Read-EnvValue 'BACKUP_DIR' '.\backups')
    $dump = $null
    if (Test-Path -LiteralPath $backupDir) {
        $dump = Get-ChildItem -LiteralPath $backupDir -Filter 'smp-*.sql.gz' -File |
            Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-5) } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    if (-not $dump -or $dump.Length -le 0) { throw "Aucun fichier de sauvegarde récent trouvé dans $backupDir." }

    Write-Host '2/5 Préparation du contenu...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Path (Join-Path $stage 'database') -Force | Out-Null
    Copy-Item -LiteralPath $dump.FullName -Destination (Join-Path $stage 'database')

    $uploadDir = Resolve-Dir (Read-EnvValue 'UPLOAD_DIR' '.\uploads')
    if (Test-Path -LiteralPath $uploadDir) {
        Copy-Item -LiteralPath $uploadDir -Destination (Join-Path $stage 'uploads') -Recurse
    } else {
        Write-Host "Dossier des fichiers téléversés introuvable ($uploadDir) : archive sans fichiers téléversés." -ForegroundColor Yellow
        New-Item -ItemType Directory -Path (Join-Path $stage 'uploads') -Force | Out-Null
    }

    Write-Host '3/5 Manifeste et empreintes SHA-256...' -ForegroundColor Cyan
    $entries = @(Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
        [pscustomobject]@{
            path   = $_.FullName.Substring($stage.Length).TrimStart('\')
            size   = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
    $manifest = [ordered]@{
        created_at    = (Get-Date).ToString('s')
        machine       = $env:COMPUTERNAME
        note          = 'Archive de données (base + fichiers téléversés), sans .env ni code secret.'
        database_dump = $dump.Name
        file_count    = $entries.Count
        files         = $entries
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'MANIFEST.json') -Encoding UTF8

    Write-Host '4/5 Création de l''archive...' -ForegroundColor Cyan
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal

    Write-Host '5/5 Vérification de l''archive (extraction temporaire)...' -ForegroundColor Cyan
    Expand-Archive -LiteralPath $archive -DestinationPath $verify -Force
    $check = Get-Content -LiteralPath (Join-Path $verify 'MANIFEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($f in @($check.files)) {
        $p = Join-Path $verify $f.path
        if (-not (Test-Path -LiteralPath $p)) { throw "Fichier manquant dans l'archive : $($f.path)" }
        if ((Get-Item -LiteralPath $p).Length -ne [int64]$f.size) { throw "Taille incorrecte dans l'archive : $($f.path)" }
        if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $f.sha256) { throw "SHA-256 incorrect dans l'archive : $($f.path)" }
    }
    $ok = $true
    Write-Host ''
    Write-Host ('Sauvegarde complète vérifiée : ' + $archive + ' (' + [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 2) + ' Mo, ' + $entries.Count + ' fichiers)') -ForegroundColor Green
    Write-Host 'Cette vérification ne remplace pas un test de restauration sur une base distincte.'
} catch {
    Write-Host ('ÉCHEC : ' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    if (-not $ok -and (Test-Path -LiteralPath $archive)) {
        Remove-Item -LiteralPath $archive -Force
        Write-Host 'Archive incomplète supprimée.' -ForegroundColor Yellow
    }
    foreach ($tmp in @($stage, $verify)) {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
exit $exitCode
