# Station Manager Pro — précontrôle A5 avant restauration SQL complète
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\a5-preflight-restore.ps1
# Lecture seule : ne se connecte pas à PostgreSQL et ne lance AUCUNE restauration.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { Write-Error '.env absent : contrôle impossible.'; exit 1 }
function Read-EnvValue([string]$Name) {
    $v = [Environment]::GetEnvironmentVariable($Name)
    if ($v) { return $v }
    foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
        if ($line -match '^\s*#') { continue }
        if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)$')) {
            $x = $Matches[1].Trim()
            if ($x.Length -ge 2 -and (($x.StartsWith('"') -and $x.EndsWith('"')) -or ($x.StartsWith("'") -and $x.EndsWith("'")))) { $x = $x.Substring(1, $x.Length - 2) }
            return $x
        }
    }
    return ''
}
$errors = 0
function Fail([string]$m) { $script:errors++; Write-Host "[BLOQUÉ] $m" -ForegroundColor Red }
function Pass([string]$m) { Write-Host "[OK] $m" -ForegroundColor Green }
Write-Host 'A5 — précontrôle de restauration complète (aucune action destructive)' -ForegroundColor Cyan
$urlText = Read-EnvValue 'DATABASE_URL'
if (-not $urlText) { Fail 'DATABASE_URL absente'; $dbName = '' }
else {
    try {
        $uri = [System.Uri]$urlText
        $dbName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
        if (-not $dbName) { Fail 'Nom de base absent dans DATABASE_URL' }
        elseif ($dbName -notmatch '(?i)(?:_test|_isolated|_isolee)$') { Fail "La base '$dbName' ne se termine pas par _test, _isolated ou _isolee" }
        else { Pass "Nom de base compatible avec une cible de test : $dbName" }
        if ($uri.Host -notin @('localhost','127.0.0.1','::1')) { Fail 'Hôte non local : ce précontrôle refuse une restauration complète distante' }
        else { Pass 'Hôte PostgreSQL local' }
    } catch { Fail 'DATABASE_URL invalide ou non analysable'; $dbName = '' }
}
if ((Read-EnvValue 'RESTORE_ENABLED') -ne '1') { Fail 'RESTORE_ENABLED doit valoir 1 uniquement pour le test contrôlé' } else { Pass 'RESTORE_ENABLED=1' }
if ((Read-EnvValue 'RESTORE_TARGET_ISOLATED') -ne '1') { Fail 'RESTORE_TARGET_ISOLATED doit valoir 1 uniquement après vérification manuelle de l’isolation' } else { Pass 'RESTORE_TARGET_ISOLATED=1 (déclaration, pas preuve d’isolation)' }
if ($errors -gt 0) { Write-Host "ÉCHEC : $errors contrôle(s). Aucune restauration n’a été lancée." -ForegroundColor Red; exit 1 }
Write-Host 'PRÉCONTRÔLE OK — ce résultat ne prouve pas que la base est vide ou sauvegardée.' -ForegroundColor Yellow
Write-Host 'Vérifiez manuellement le nom, le contenu et les sauvegardes de la base avant toute action.'
Write-Host 'Ce script ne lance jamais la restauration.'
exit 0
