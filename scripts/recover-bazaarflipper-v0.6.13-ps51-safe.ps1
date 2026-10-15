# BazaarFlipper offline-safe recovery installer. Tested on Windows PowerShell 5.1+
# Close BazaarFlipper first. The script never deletes or replaces the data directory.
param(
  [string]$ProjectRoot = 'F:\bazzarFlipper',
  [string]$ManifestUrl = 'https://raw.githubusercontent.com/kingame111/bazaarflipper-updates/main/manifest.json'
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Hash-Bytes([byte[]]$bytes) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
  finally {$sha.Dispose()}
}
function Fetch-Text([string]$uri) {
  $last=$null
  for($attempt=1;$attempt -le 4;$attempt++){
    try {
      $r=Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 40
      if($r.StatusCode -ne 200){throw "HTTP $($r.StatusCode)"}
      return [string]$r.Content
    } catch {
      $last=$_
      Write-Host "Download retry $attempt for $uri : $($_.Exception.Message)"
      if($attempt -lt 4){Start-Sleep -Seconds ($attempt*2)}
    }
  }
  throw "Download failed after four attempts: $uri ($last)"
}
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
if(!(Test-Path -LiteralPath $ProjectRoot -PathType Container)){throw "Project directory not found: $ProjectRoot"}
if(!(Test-Path -LiteralPath (Join-Path $ProjectRoot 'server.mjs'))){throw "Not a BazaarFlipper folder: $ProjectRoot"}
if(!$ManifestUrl.StartsWith('https://')){throw 'Manifest URL must use HTTPS'}
$client=New-Object Net.Sockets.TcpClient
try{
  $ar=$client.BeginConnect('127.0.0.1',3210,$null,$null)
  if($ar.AsyncWaitHandle.WaitOne(600)){try{$client.EndConnect($ar);throw 'BazaarFlipper is still running on port 3210. Close the BazaarFlipper window, then rerun this installer.'}catch [Net.Sockets.SocketException]{}}
} finally {$client.Close()}
$logDir=Join-Path $ProjectRoot 'logs'
$updates=Join-Path $ProjectRoot 'data\updates'
New-Item -Path $logDir,$updates -ItemType Directory -Force | Out-Null
$log=Join-Path $logDir 'update-recovery.log'
function Log([string]$message){Add-Content -LiteralPath $log -Value ("$(Get-Date -Format o) $message")}
Log "Recovery started; project=$ProjectRoot"
$manifest=Fetch-Text $ManifestUrl | ConvertFrom-Json
if(!$manifest.version -or !$manifest.files -or !$manifest.bundle.parts -or $manifest.bundle.encoding -ne 'gzip-base64'){throw 'Invalid manifest'}
$rootUri=New-Object Uri($ManifestUrl)
$encoded=''
$i=0
foreach($part in $manifest.bundle.parts){
  $i++
  if([string]$part -notmatch '^\./releases/[0-9.]+/part-[0-9]+\.txt$'){throw "Unsafe bundle path: $part"}
  $uri=(New-Object Uri($rootUri,[string]$part)).AbsoluteUri
  $piece=(Fetch-Text $uri).Trim()
  if($piece.Length -gt 131072){throw 'Bundle chunk too large'}
  $encoded+=$piece
  Log "Downloaded part $i / $($manifest.bundle.parts.Count)"
}
$archive=[Convert]::FromBase64String($encoded)
if((Hash-Bytes $archive) -ne [string]$manifest.bundle.sha256){throw 'Bundle SHA256 mismatch'}
$memory=New-Object IO.MemoryStream(,$archive)
$gzip=New-Object IO.Compression.GZipStream($memory,[IO.Compression.CompressionMode]::Decompress)
$reader=New-Object IO.StreamReader($gzip)
try {$payload=$reader.ReadToEnd() | ConvertFrom-Json}
finally {$reader.Dispose();$gzip.Dispose();$memory.Dispose()}
$id=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$stage=Join-Path $updates "recovery-stage-$id"
$backup=Join-Path $updates "recovery-backup-$id"
New-Item -Path $stage,$backup -ItemType Directory -Force | Out-Null
$copied=New-Object System.Collections.Generic.List[string]
try {
  foreach($file in $manifest.files){
    $rel=[string]$file.path
    if(!$rel -or $rel.Contains('\') -or $rel.StartsWith('/') -or
        $rel -match '(^|/)\.\.?(/|$)' -or $rel -match '^[A-Za-z]:'){throw "Unsafe target: $rel"}
    if($rel -like 'data/*' -or $rel -like 'logs/*' -or $rel -eq 'config.json'){throw "Refusing to overwrite user data: $rel"}
    $prop=$payload.files.PSObject.Properties[$rel]
    if(!$prop){throw "File missing from bundle: $rel"}
    $bytes=[Convert]::FromBase64String([string]$prop.Value)
    if((Hash-Bytes $bytes) -ne [string]$file.sha256){throw "Checksum mismatch: $rel"}
    $relativeWin=$rel.Replace('/','\')
    $dest=Join-Path $stage $relativeWin
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    [IO.File]::WriteAllBytes($dest,$bytes)
  }
  $node=(Get-Command node -ErrorAction SilentlyContinue)
  if(!$node){throw 'Node.js not found in PATH. Install Node.js 22.5 or newer first.'}
  foreach($js in @('server.mjs','src\updater.mjs','src\db.mjs','src\maintenance-worker.mjs')){
    $p=Join-Path $stage $js
    if(Test-Path $p){& node --check $p; if($LASTEXITCODE -ne 0){throw "Node syntax check failed: $js"}}
  }
  Log "All staged files and checksums verified"
  foreach($file in $manifest.files){
    $relativeWin=([string]$file.path).Replace('/','\')
    $dest=Join-Path $ProjectRoot $relativeWin
    $originalBackup=Join-Path $backup $relativeWin
    New-Item -ItemType Directory -Path (Split-Path -Parent $originalBackup) -Force | Out-Null
    if(Test-Path -LiteralPath $dest){Copy-Item -LiteralPath $dest -Destination $originalBackup -Force}
    else{New-Item -ItemType File -Path "$originalBackup.was-absent" -Force | Out-Null}
    $copied.Add($relativeWin)
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $stage $relativeWin) -Destination $dest -Force
  }
  $version=(Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json).version
  if($version -ne $manifest.version){throw "Installed version mismatch: $version"}
  Log "Updated code to v$version; original code retained at $backup; database untouched"
  Write-Host "SUCCESS: BazaarFlipper v$version files installed."
  Write-Host "Database and config were NOT modified."
  Write-Host "Backup of prior code: $backup"
  Write-Host "Now launch start-bazaarflip.bat and confirm the displayed server version."
}catch{
  Log "FAILED: $($_.Exception.Message) - restoring prior code"
  for($j=$copied.Count-1;$j -ge 0;$j--){
    $relativeWin=$copied[$j]
    $target=Join-Path $ProjectRoot $relativeWin
    $old=Join-Path $backup $relativeWin
    if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination $target -Force}
    elseif(Test-Path -LiteralPath "$old.was-absent"){Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue}
  }
  throw
}
