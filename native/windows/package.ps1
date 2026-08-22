param(
  [string]$Entry = "examples/windows-hello.ts",
  [string]$Name = "BunKitApp",
  [string]$OutDir = "dist"
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot
$extra = @($args | Where-Object { $_ -ne "--" })
for ($i = 0; $i -lt $extra.Count; $i++) {
  if ($extra[$i] -eq "--name" -and $i + 1 -lt $extra.Count) { $Name = $extra[$i + 1]; $i++ }
  elseif ($extra[$i] -like "*.ts") { $Entry = $extra[$i] }
}

if (-not (Test-Path $Entry)) { throw "Entry not found: $Entry" }
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $makeappx) { throw "makeappx.exe not found. Install Windows SDK." }
if (-not $signtool) { throw "signtool.exe not found. Install Windows SDK." }

& powershell -ExecutionPolicy Bypass -File native/windows/build.ps1
if ($LASTEXITCODE -ne 0) { throw "native build failed" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem $OutDir -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @("dependencies", "BunKitApp.exe", "BunKitApp.msix", "BunKitApp.cer", "Install-BunKitApp.ps1", "README-install.txt") -or $_.Extension -in @(".dll", ".pri") } |
  Remove-Item -Recurse -Force
$stage = Join-Path $env:TEMP "bunkit-msix-stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path "$stage\Assets" | Out-Null

& bun build --compile $Entry --outfile "$stage\$Name.exe" --target=bun-windows-x64-modern
if ($LASTEXITCODE -ne 0) { throw "bun compile failed" }
Copy-Item build\winbridge.dll "$stage\"
Copy-Item build\Microsoft.WindowsAppRuntime.Bootstrap.dll "$stage\"
$manifest = (Get-Content native\windows\package-manifest.xml -Raw).Replace("BunKitApp.exe", "$Name.exe")
Set-Content "$stage\AppxManifest.xml" $manifest -Encoding UTF8

# Minimal valid PNG placeholders for manifest logos.
$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
foreach ($logo in @("StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png")) { [IO.File]::WriteAllBytes("$stage\Assets\$logo", $png) }

$appx = Join-Path $OutDir "$Name.msix"
if (Test-Path $appx) { Remove-Item $appx }
& $makeappx pack /d $stage /p $appx /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }

$certPath = Join-Path $OutDir "BunKitApp.cer"
$pfxPath = Join-Path $env:TEMP "BunKitApp.pfx"
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=BunKit Development" -KeyUsage DigitalSignature -FriendlyName "BunKit Development" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.19={text}false", "2.5.29.37={text}1.3.6.1.5.5.7.3.3")
Export-Certificate -Cert $cert -FilePath $certPath | Out-Null
$password = ConvertTo-SecureString "bunkit" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
& $signtool sign /fd SHA256 /f $pfxPath /p bunkit $appx
if ($LASTEXITCODE -ne 0) { throw "signtool failed" }

$runtimeDir = Join-Path $OutDir "dependencies"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Copy-Item native\windows\deps\wasdk17\tools\MSIX\win10-x64\Microsoft.WindowsAppRuntime*.msix $runtimeDir -Force
@"
Run Install-BunKitApp.ps1 in PowerShell to install the Microsoft Windows App Runtime dependencies and BunKitApp.msix.
The script trusts BunKitApp.cer for the current user before installing.
"@ | Set-Content (Join-Path $OutDir "README-install.txt")
@'
$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $cert = Join-Path $PSScriptRoot "BunKitApp.cer"
  Start-Process certutil.exe -Verb RunAs -Wait -ArgumentList @("-addstore", "-f", "Root", "`"$cert`"")
}
Import-Certificate -FilePath "$PSScriptRoot\BunKitApp.cer" -CertStoreLocation Cert:\CurrentUser\TrustedPeople -ErrorAction SilentlyContinue | Out-Null
foreach ($name in @("Microsoft.WindowsAppRuntime.1.7.msix", "Microsoft.WindowsAppRuntime.DDLM.1.7.msix", "Microsoft.WindowsAppRuntime.Singleton.1.7.msix", "Microsoft.WindowsAppRuntime.Main.1.7.msix")) {
  try {
    Add-AppxPackage -Path (Join-Path $PSScriptRoot "dependencies\$name")
  } catch {
    if ($_.Exception.Message -notmatch "0x80073D06|vers[aã]o superior|higher version") { throw }
  }
}
Add-AppxPackage -Path "$PSScriptRoot\BunKitApp.msix"
Write-Host "BunKit App installed."
'@ | Set-Content (Join-Path $OutDir "Install-BunKitApp.ps1")
Remove-Item $pfxPath -Force -ErrorAction SilentlyContinue
Remove-Item $stage -Recurse -Force
Write-Host "Created $appx and runtime dependencies in $runtimeDir"
