<#
.SYNOPSIS
  Deploys the My Property Box site (static pages plus the viewing API) to Azure App Service on Linux.

.DESCRIPTION
  Creates (or updates) a resource group, App Service plan and web app running Node 20, then zip-deploys the
  site and checks /api/health. The site has no build step and no npm dependencies.

  Nothing is created until you have run `az login` and confirmed the subscription shown. Credentials are
  never written into the package. Add CRM secrets afterwards with `az webapp config appsettings set`.

  By default the site is a hidden preview: every page gets <meta name="robots" content="noindex,nofollow">,
  the server sends an X-Robots-Tag: noindex header and robots.txt disallows everything, the same as the
  GitHub Pages preview.

  -Index is the go-live switch. It sets ALLOW_INDEXING=1 and SITE_URL, which turns on the public robots.txt,
  the sitemap and the 301 redirect from any other hostname (including <AppName>.azurewebsites.net) to SITE_URL.
  Only use it once the custom domain is bound to the app and DNS points at it, otherwise visitors to the
  azurewebsites.net address are sent to a site that is not there yet. See the README, "Going live".

.EXAMPLE
  az login
  ./deploy/azure-deploy.ps1 -AppName mpb-preview-abc

.EXAMPLE
  ./deploy/azure-deploy.ps1 -AppName mpb-live -Sku B1 -DiaryMode live -Index    # go live on https://www.mypropertybox.co.uk

.EXAMPLE
  ./deploy/azure-deploy.ps1 -AppName mpb-preview-abc -PackageOnly    # build the zip, touch nothing in Azure
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$')]
  [string]$AppName,                       # becomes https://<AppName>.azurewebsites.net and must be globally unique
  [string]$ResourceGroup = 'rg-mpb-preview',
  [string]$Location = 'uksouth',
  [string]$Sku = 'B1',                    # F1 is free but sleeps when idle and has no Always On
  [ValidateSet('demo', 'live')]
  [string]$DiaryMode = 'demo',            # demo = sample viewing times; live = real CRM adapters only
  [string]$SubscriptionId,
  [switch]$Index,                         # go live: indexable pages, sitemap, canonical-host redirect to -SiteUrl
  [ValidatePattern('^https://[a-z0-9.-]+$')]
  [string]$SiteUrl = 'https://www.mypropertybox.co.uk',   # the public address, no trailing slash; used with -Index
  [switch]$PackageOnly,                   # build the zip and stop
  [switch]$Yes                            # skip the confirmation prompt
)

$ErrorActionPreference = 'Stop'
$env:AZURE_CORE_ONLY_SHOW_ERRORS = 'true'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$zipPath = Join-Path ([System.IO.Path]::GetTempPath()) "$AppName-site.zip"

function Invoke-Az {
  & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

# Zip entries must use forward slashes for Linux. Compress-Archive in Windows PowerShell 5.1 does not.
function New-SitePackage([string]$Root, [string]$Zip, [bool]$NoIndex) {
  if (Test-Path $Zip) { Remove-Item $Zip -Force }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $meta = '<head><meta name="robots" content="noindex,nofollow">'
  $count = 0
  $archive = [System.IO.Compression.ZipFile]::Open($Zip, 'Create')
  try {
    $files = New-Object System.Collections.Generic.List[string]
    Get-ChildItem -Path $Root -File | Where-Object { $_.Extension -in '.html', '.css', '.js' } | ForEach-Object { $files.Add($_.FullName) }
    foreach ($dir in 'assets', 'data', 'vendor', 'server') {
      $p = Join-Path $Root $dir
      if (-not (Test-Path $p)) { continue }
      Get-ChildItem -Path $p -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
        # Keep tests, local runtime data and secrets out of the package
        if ($rel -match '^server[\\/](test|data)[\\/]' -or $_.Name -like '.env*') { return }
        $files.Add($_.FullName)
      }
    }
    foreach ($f in $files) {
      $rel = $f.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
      if ($NoIndex -and $rel -notmatch '/' -and $rel.EndsWith('.html')) {
        $text = [System.IO.File]::ReadAllText($f).Replace('<head>', $meta)
        $entry = $archive.CreateEntry($rel, 'Optimal')
        $s = $entry.Open()
        try { $b = $utf8.GetBytes($text); $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
      } else {
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f, $rel, 'Optimal')
      }
      $count++
    }
  } finally { $archive.Dispose() }
  return $count
}

Write-Host "Packaging $root ..."
$n = New-SitePackage -Root $root -Zip $zipPath -NoIndex (-not $Index)
Write-Host ("Built {0} ({1} files, {2:N1} MB){3}" -f $zipPath, $n, ((Get-Item $zipPath).Length / 1MB), $(if ($Index) { '' } else { ', noindex' }))
if ($PackageOnly) { return }

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI (az) is not installed. See https://aka.ms/installazurecli' }
if ($SubscriptionId) { Invoke-Az account set --subscription $SubscriptionId }
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$acctJson = & az account show --query '{name:name,id:id,user:user.name}' -o json 2>$null
$signedIn = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prev
if (-not $signedIn) { throw 'Not signed in to Azure. Run `az login` first, then re-run this script.' }
$acct = $acctJson | ConvertFrom-Json

$plan = "$AppName-plan"
Write-Host ''
Write-Host "Subscription : $($acct.name) ($($acct.id))"
Write-Host "Signed in as : $($acct.user)"
Write-Host "Will create  : resource group '$ResourceGroup' in $Location, plan '$plan' ($Sku, Linux), web app '$AppName' (Node 20)"
Write-Host "Diary mode   : $DiaryMode"
if ($Index) {
  Write-Host "Indexing     : ON. Search engines may index $SiteUrl. Other hostnames, including https://$AppName.azurewebsites.net, will 301 to it."
} else {
  Write-Host 'Indexing     : off (hidden preview)'
}
if ($Sku -eq 'F1') { Write-Host 'Note: F1 is free but sleeps when idle, so the first visit after a quiet spell is slow.' }
if (-not $Yes) {
  if ((Read-Host 'Create these resources and deploy? (y/N)') -notmatch '^[yY]') { Write-Host 'Cancelled. Nothing was created.'; return }
}

Invoke-Az group create --name $ResourceGroup --location $Location --output none
Invoke-Az appservice plan create --name $plan --resource-group $ResourceGroup --location $Location --is-linux --sku $Sku --output none
Invoke-Az webapp create --name $AppName --resource-group $ResourceGroup --plan $plan --runtime 'NODE:20-lts' --output none

$settings = @(
  'HOST=0.0.0.0',
  'TRUST_PROXY=1',
  'DATA_DIR=/home/mpb-data',
  'GEOCACHE_FILE=/home/mpb-data/geocache.json',
  'SCM_DO_BUILD_DURING_DEPLOYMENT=false'
)
if ($DiaryMode -eq 'demo') { $settings += 'DIARY_MODE=demo' }
if ($Index) { $settings += 'ALLOW_INDEXING=1'; $settings += "SITE_URL=$SiteUrl" }
Invoke-Az webapp config appsettings set --name $AppName --resource-group $ResourceGroup --settings @settings --output none
if ($DiaryMode -eq 'live') { Invoke-Az webapp config appsettings delete --name $AppName --resource-group $ResourceGroup --setting-names DIARY_MODE --output none }
if (-not $Index) { Invoke-Az webapp config appsettings delete --name $AppName --resource-group $ResourceGroup --setting-names ALLOW_INDEXING SITE_URL --output none }

Invoke-Az webapp update --name $AppName --resource-group $ResourceGroup --https-only true --output none
Invoke-Az webapp config set --name $AppName --resource-group $ResourceGroup --startup-file 'node server/server.js' --min-tls-version 1.2 --ftps-state Disabled --http20-enabled true --output none
if ($Sku -notin 'F1', 'D1') { Invoke-Az webapp config set --name $AppName --resource-group $ResourceGroup --always-on true --output none }

Write-Host 'Uploading the site ...'
Invoke-Az webapp deploy --name $AppName --resource-group $ResourceGroup --src-path $zipPath --type zip --clean true --output none

$url = "https://$AppName.azurewebsites.net"
Write-Host "Checking $url/api/health ..."
$ok = $false
for ($i = 0; $i -lt 24 -and -not $ok; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 15
    if ($r.ok) { $ok = $true; Write-Host "Healthy (mode: $($r.mode))." }
  } catch { Start-Sleep -Seconds 5 }
}
if (-not $ok) { Write-Warning "No healthy response yet. Check the logs: az webapp log tail --name $AppName --resource-group $ResourceGroup" }

Write-Host ''
Write-Host "Site: $url"
Write-Host 'Next steps:'
Write-Host '  - Forms run in preview mode (nothing is sent) until LEAD.endpoint is set in common.js, then redeploy.'
Write-Host '  - Add CRM secrets as app settings, never in code, for example:'
Write-Host "      az webapp config appsettings set -n $AppName -g $ResourceGroup --settings VECO_CLIENT_ID=... VECO_CLIENT_SECRET=... VECO_RESOURCE_IDS=..."
Write-Host '  - The property feed is the snapshot in data/. Redeploy to refresh it (see README, "Azure").'
if ($Index) {
  Write-Host "  - Live: bind the domain (az webapp config hostname add / az webapp config ssl create) so $SiteUrl reaches this app,"
  Write-Host '    then submit the sitemap in Google Search Console. See the README, "Going live".'
} else {
  Write-Host '  - When the domain points at this app, re-run with -Index to go live (README, "Going live").'
}
Write-Host "  - Tear down when finished: az group delete --name $ResourceGroup"
