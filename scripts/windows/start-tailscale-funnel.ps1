# Station Manager Pro — aide pour l'accès distant via Tailscale
# Ce script AFFICHE seulement la procédure. L'exposition publique (Funnel) n'est pas lancée automatiquement.
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-tailscale-funnel.ps1

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

$port = Read-EnvValue 'PORT' '3000'

Write-Host 'Accès distant à Station Manager Pro via Tailscale' -ForegroundColor Cyan
Write-Host ''
Write-Host 'IMPORTANT : la commande Funnel n’est pas lancée automatiquement par ce script.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Option recommandée — Tailscale Serve (privé, appareils autorisés du tailnet uniquement) :'
Write-Host "  tailscale serve $port"
Write-Host ''
Write-Host 'Option publique — Tailscale Funnel (accessible depuis tout Internet, sans Tailscale) :'
Write-Host '  Funnel expose l''écran de connexion à toute personne possédant l''URL. L''URL n''est pas une authentification.'
Write-Host '  À n''envisager qu''après : test des permissions API, mots de passe forts, verrouillage de connexion,'
Write-Host '  contrôle des uploads, sauvegarde récente vérifiée.'
Write-Host "  Commande à saisir vous-même, adaptée à votre version de Tailscale (ex. : tailscale funnel $port)"
Write-Host ''
Write-Host 'Pour arrêter toute exposition : tailscale funnel reset  (puis tailscale serve reset si besoin)'
Write-Host ''
Write-Host 'Prérequis : serveur démarré avec scripts\windows\start-pc-server.ps1 (écoute locale 127.0.0.1, jointe par le proxy Tailscale).'
Write-Host 'Ne jamais ouvrir les ports 3000 ou 5432 sur le routeur.'
