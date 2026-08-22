param(
  [string]$Entry = "examples/windows-hello.ts",
  [string]$Name = "BunKitApp",
  [string]$OutDir = "dist"
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

# Parse args when invoked via `bun run bundle:windows -- <entry> --name <name>`
# `--` is just Bun's separator and should be ignored
$extra = @($args | Where-Object { $_ -ne "--" })
for ($i = 0; $i -lt $extra.Count; $i++) {
  if ($extra[$i] -eq "--name" -and $i + 1 -lt $extra.Count) { $Name = $extra[$i+1]; $i++ }
  elseif ($extra[$i] -like "*.ts") { $Entry = $extra[$i] }
}

if (-not (Test-Path $Entry)) {
  throw "Entry not found: $Entry"
}

Write-Host "== BunKit Windows bundle =="
Write-Host "  entry: $Entry"
Write-Host "  name:  $Name"
Write-Host "  out:   $OutDir/$Name.exe"

# Ensure native is built
if (-not (Test-Path "build/winbridge.dll")) {
  Write-Host "  building winbridge.dll..."
  & powershell -ExecutionPolicy Bypass -File native/windows/build.ps1
  if ($LASTEXITCODE -ne 0) { throw "build:windows failed" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "  compiling $Entry -> $OutDir/$Name.exe"
& bun build --compile $Entry --outfile "$OutDir/$Name.exe" --target=bun-windows-x64-modern
if ($LASTEXITCODE -ne 0) { throw "bun build --compile failed" }

Write-Host "  copying runtime deps"
Copy-Item -Force "build/winbridge.dll" "$OutDir/"
Copy-Item -Force "build/Microsoft.WindowsAppRuntime.Bootstrap.dll" "$OutDir/" -ErrorAction SilentlyContinue
Copy-Item -Force "native/windows/deps/wasdk17/runtimes/win-x64/native/Microsoft.WindowsAppRuntime.Bootstrap.dll" "$OutDir/" -ErrorAction SilentlyContinue

# Self-contained: unpack the framework MSIX next to the exe so the app
# runs on machines without the Windows App Runtime installed (no MSIX needed).
# The Main package contains Microsoft.UI.Xaml.dll etc.; DDLM/Singleton contain
# the DynamicDependency lifetime managers.
Write-Host "  unpacking WindowsAppRuntime framework for self-contained run"
$msixRoot = "native/windows/deps/wasdk17/tools/MSIX/win10-x64"
$tmp = Join-Path $env:TEMP "bunkit-wasdk-unpack"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
foreach ($msix in @("Microsoft.WindowsAppRuntime.1.7.msix", "Microsoft.WindowsAppRuntime.Main.1.7.msix", "Microsoft.WindowsAppRuntime.DDLM.1.7.msix", "Microsoft.WindowsAppRuntime.Singleton.1.7.msix")) {
  $p = Join-Path $msixRoot $msix
  if (Test-Path $p) {
    Expand-Archive -Path $p -DestinationPath $tmp -Force
  }
}
# Also unpack the 1.8 umbrella if present (win32 build uses 1.8 winmds)
$msix18Root = "native/windows/deps/winui/tools/MSIX/win10-x64"
if (Test-Path $msix18Root) {
  foreach ($msix in @("Microsoft.WindowsAppRuntime.1.8.msix", "Microsoft.WindowsAppRuntime.Main.1.8.msix")) {
    $p = Join-Path $msix18Root $msix
    if (Test-Path $p) { Expand-Archive -Path $p -DestinationPath $tmp -Force }
  }
}
# Copy the framework binaries next to the exe (duplicates are harmless)
Get-ChildItem $tmp -Recurse -Filter "*.dll" | ForEach-Object { Copy-Item -Force $_.FullName "$OutDir/" -ErrorAction SilentlyContinue }
# Also copy the .pri and other resources if present (for XAML themes)
Get-ChildItem $tmp -Recurse -Filter "*.pri" | ForEach-Object { Copy-Item -Force $_.FullName "$OutDir/" -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host "  framework unpacked to $OutDir (self-contained)"

# Hide the console window (CONSOLE -> WINDOWS subsystem)
try {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  $vsPath = & $vswhere -latest -products * -property installationPath
  $editbin = Get-ChildItem "$vsPath\VC\Tools\MSVC\*\bin\Hostx64\x64\editbin.exe" | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  if ($editbin) {
    Write-Host "  patching subsystem to WINDOWS (no console)"
    & $editbin /SUBSYSTEM:WINDOWS "$OutDir/$Name.exe" | Out-Null
  } else {
    Write-Host "  warning: editbin not found, exe will still show console"
  }
} catch {
  Write-Host "  warning: could not patch subsystem: $_"
}

Write-Host "done. Run: $OutDir/$Name.exe"
Get-ChildItem "$OutDir" | Format-Table Name, Length, LastWriteTime -AutoSize
