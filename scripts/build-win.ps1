$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot 'native\bin'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compilerPath /nologo /optimize+ /target:exe /reference:System.Web.Extensions.dll "/out:$outputPath\display-ddc.exe" (Join-Path $projectRoot 'native\windows\DisplayDdc.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows helper compilation failed' }
& $compilerPath /nologo /optimize+ /target:exe /reference:System.Web.Extensions.dll "/out:$outputPath\keyboard-control.exe" (Join-Path $projectRoot 'native\windows\KeyboardControl.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows keyboard helper compilation failed' }
