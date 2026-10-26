param([Parameter(Mandatory=$true)][string]$BuildPath,[int]$DebugPort=0)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$sourceRoot=(Resolve-Path -LiteralPath $BuildPath).Path.TrimEnd('\')
$targetRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot 'release\win-unpacked')).TrimEnd('\')
if($sourceRoot -eq $targetRoot -or !(Test-Path -LiteralPath (Join-Path $sourceRoot 'resources\app.asar'))){throw 'Invalid build directory'}
if($DebugPort -ne 0 -and ($DebugPort -lt 1024 -or $DebugPort -gt 65535)){throw 'Invalid debug port'}
New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot 'resources') | Out-Null
$archivePath=Join-Path $targetRoot 'resources\app.asar'
$archiveLock=$null
for($attempt=0;$attempt -lt 5;$attempt++){
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($targetRoot+'\',[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
  Start-Sleep -Milliseconds 500
  try{$archiveLock=[IO.File]::Open($archivePath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);break}catch{if($attempt -eq 4){throw 'Application resources are still in use; installation was not applied.'}}
}
try{
  # Holding an exclusive archive handle prevents a concurrently launched process
  # from loading old offsets while the resource archive is being replaced.
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($targetRoot+'\',[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
  foreach($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File){
    $relative=$file.FullName.Substring($sourceRoot.Length).TrimStart('\')
    if($relative -eq 'resources\app.asar'){continue}
    $destination=[IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
    if(!$destination.StartsWith($targetRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Destination is outside application directory'}
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  }
  $payload=[IO.File]::ReadAllBytes((Join-Path $sourceRoot 'resources\app.asar'))
  $archiveLock.Position=0;$archiveLock.Write($payload,0,$payload.Length);$archiveLock.SetLength($payload.Length);$archiveLock.Flush($true)
}finally{if($archiveLock){$archiveLock.Dispose()}}
$sourceHash=(Get-FileHash -LiteralPath (Join-Path $sourceRoot 'resources\app.asar') -Algorithm SHA256).Hash
$installedHash=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if($sourceHash -ne $installedHash){throw 'Installed resource archive verification failed'}
$launchArgs=@('--background')
if($DebugPort){$launchArgs+=@('--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$DebugPort")}
Start-Process -FilePath (Join-Path $targetRoot 'DisplayBridge.exe') -ArgumentList $launchArgs -WindowStyle Hidden
Write-Output 'Application installed; archive verified and background process started.'
