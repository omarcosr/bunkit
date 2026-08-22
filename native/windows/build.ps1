# Builds winbridge.dll via msbuild + NuGet restore and deploys it to
# <repo root>/build/winbridge.dll.
#
#   powershell -ExecutionPolicy Bypass -File native/windows/build.ps1 [-Clean]
#
# The vcxproj references Microsoft.WindowsAppSDK + Microsoft.Windows.CppWinRT,
# so msbuild -restore pulls those and runs C++/WinRT codegen itself. The only
# manually fetched piece is the 1.7 monolith package that still ships the
# MddBootstrap import lib we link against.
param(
  [string]$Configuration = "Release",
  [switch]$Clean
)
$ErrorActionPreference = "Stop"

$WASDK17_VERSION = "1.7.260224002"   # last monolithic pkg with Bootstrap.lib

$winDir    = $PSScriptRoot           # native/windows
$bridgeDir = Join-Path $winDir "bridge"
$repoRoot  = Split-Path -Parent (Split-Path -Parent $winDir)
$depsDir   = Join-Path $winDir "deps"
$sdkDir    = Join-Path $depsDir "wasdk17"
$outDir    = Join-Path $winDir "build\$Configuration\x64"
# Fossil from the pre-msbuild era; msbuild outputs to $outDir.
Remove-Item -Force (Join-Path $winDir "build\$Configuration\winbridge.dll") -ErrorAction SilentlyContinue
$deploy    = Join-Path $repoRoot "build"

if ($Clean) {
  foreach ($d in @($outDir, (Join-Path $winDir "build\obj"), (Join-Path $bridgeDir "generated"))) {
    if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  }
}
New-Item -ItemType Directory -Force -Path $deploy | Out-Null

function Fetch-Nupkg([string]$Id, [string]$Version, [string]$Dest) {
  if (Test-Path (Join-Path $Dest ".done")) { return }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  $url  = "https://api.nuget.org/v3-flatcontainer/$Id/$Version/$Id.$Version.nupkg"
  $zip  = Join-Path $env:TEMP "$Id.$Version.nupkg.zip"
  Write-Host "  fetching $Id $Version"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $Dest -Force
  Remove-Item $zip
  New-Item -ItemType File -Force -Path (Join-Path $Dest ".done") | Out-Null
}

Fetch-Nupkg "microsoft.windowsappsdk" $WASDK17_VERSION $sdkDir

$bootstrapLib = Join-Path $sdkDir "lib\win10-x64\Microsoft.WindowsAppRuntime.Bootstrap.lib"
if (-not (Test-Path $bootstrapLib)) { throw "missing $bootstrapLib" }

# --- locate msbuild ----------------------------------------------------------

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe not found. Install Visual Studio with 'Desktop development with C++'."
}
$vsPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw "No Visual Studio with MSBuild + MSVC x64 tools found." }
$msbuild = Get-ChildItem (Join-Path $vsPath "MSBuild\Current\Bin\MSBuild.exe") |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $msbuild) { throw "MSBuild.exe not found under $vsPath" }

# --- restore + build ---------------------------------------------------------

& $msbuild (Join-Path $bridgeDir "bridge.vcxproj") /t:Restore /m /nologo /v:m `
  /p:Configuration=$Configuration /p:Platform=x64
if ($LASTEXITCODE -ne 0) { throw "nuget/msbuild restore failed with exit code $LASTEXITCODE" }

& $msbuild (Join-Path $bridgeDir "bridge.vcxproj") /t:Build /m /nologo /v:m `
  /p:Configuration=$Configuration /p:Platform=x64
if ($LASTEXITCODE -ne 0) { throw "cl.exe failed with exit code $LASTEXITCODE" }

# --- deploy ------------------------------------------------------------------

Copy-Item -Force (Join-Path $outDir "winbridge.dll") (Join-Path $deploy "winbridge.dll")
Copy-Item -Force (Join-Path $outDir "winbridge.pdb") (Join-Path $deploy "winbridge.pdb") -ErrorAction SilentlyContinue
# The loader resolves Bootstrap.dll relative to winbridge.dll's own folder.
Copy-Item -Force (Join-Path $sdkDir "runtimes\win-x64\native\Microsoft.WindowsAppRuntime.Bootstrap.dll") `
  (Join-Path $deploy "Microsoft.WindowsAppRuntime.Bootstrap.dll")
Write-Host "built $(Join-Path $deploy 'winbridge.dll')"
