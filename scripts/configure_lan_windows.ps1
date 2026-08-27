param(
    [int]$Port = 8080,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$ruleName = "Barco Controller LAN"

if ($Remove) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    exit 0
}

if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Puerto LAN inválido: $Port"
}

# Keep one deterministic rule so upgrades do not accumulate duplicates.
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description "Permite Barco Controller únicamente desde la subred local." `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress LocalSubnet `
    -Profile Private,Domain | Out-Null

Write-Host "Barco Controller LAN habilitado en TCP $Port para LocalSubnet (Private/Domain)."
