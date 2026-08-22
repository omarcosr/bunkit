param(
  [string]$Entry = "examples/windows-hello.ts",
  [string]$Name = "BunKitApp",
  [string]$OutDir = "dist"
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot
$oldArtifacts = @("$OutDir\$Name-Setup.exe", "$OutDir\$Name-Setup.sed", "$OutDir\~$Name-Setup.DDF", "$OutDir\~$Name-Setup.CAB")
Remove-Item $oldArtifacts -Force -ErrorAction SilentlyContinue
$extra = @($args | Where-Object { $_ -ne "--" })
for ($i = 0; $i -lt $extra.Count; $i++) {
  if ($extra[$i] -eq "--name" -and $i + 1 -lt $extra.Count) { $Name = $extra[$i + 1]; $i++ }
  elseif ($extra[$i] -like "*.ts") { $Entry = $extra[$i] }
}
$normalizedEntry = $Entry.Replace("\", "/")
$windowsExamples = @("examples/hello.ts", "examples/tour.ts", "examples/demo.ts", "examples/windows-hello.ts")
if ($normalizedEntry.StartsWith("examples/") -and $normalizedEntry -notin $windowsExamples) {
  throw "This example is macOS-only on Windows: $Entry"
}

$iexpress = Join-Path $env:windir "System32\iexpress.exe"
if (-not (Test-Path $iexpress)) { throw "iexpress.exe not found" }
& powershell -ExecutionPolicy Bypass -File native/windows/build.ps1
if ($LASTEXITCODE -ne 0) { throw "native build failed" }

$looseDir = Join-Path $env:TEMP "bunkit-installer-loose"
if (Test-Path $looseDir) { Remove-Item -Recurse -Force $looseDir }
New-Item -ItemType Directory -Force -Path $looseDir | Out-Null
& bun build --compile $Entry --outfile "$looseDir\$Name.exe" --target=bun-windows-x64-modern
if ($LASTEXITCODE -ne 0) { throw "bun compile failed" }
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = & $vswhere -latest -products * -property installationPath
$editbin = Get-ChildItem "$vsPath\VC\Tools\MSVC\*\bin\Hostx64\x64\editbin.exe" | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $editbin) { throw "editbin.exe not found; cannot create a console-free client executable" }
& $editbin /SUBSYSTEM:WINDOWS "$looseDir\$Name.exe" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "failed to set WINDOWS subsystem" }

$stage = Join-Path $env:TEMP "bunkit-installer-stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item "$looseDir\$Name.exe" "$stage\$Name.exe"
Copy-Item "build\winbridge.dll" "$stage\"
Copy-Item "build\Microsoft.WindowsAppRuntime.Bootstrap.dll" "$stage\"
Copy-Item "native\windows\deps\wasdk17\tools\MSIX\win10-x64\Microsoft.WindowsAppRuntime*.msix" "$stage\" -Force

@'
$ErrorActionPreference = "Stop"
$admin = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  exit $LASTEXITCODE
}
$installDir = Join-Path ${env:ProgramFiles} "BunKitApp"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
foreach ($name in @("Microsoft.WindowsAppRuntime.1.7.msix", "Microsoft.WindowsAppRuntime.DDLM.1.7.msix", "Microsoft.WindowsAppRuntime.Singleton.1.7.msix", "Microsoft.WindowsAppRuntime.Main.1.7.msix")) {
  try { Add-AppxPackage -Path (Join-Path $PSScriptRoot $name) } catch {
    if ($_.Exception.Message -notmatch "0x80073D06|vers[aã]o superior|higher version") { throw }
  }
}
Copy-Item (Join-Path $PSScriptRoot "BunKitApp.exe") $installDir -Force
Copy-Item (Join-Path $PSScriptRoot "winbridge.dll") $installDir -Force
Copy-Item (Join-Path $PSScriptRoot "Microsoft.WindowsAppRuntime.Bootstrap.dll") $installDir -Force
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ${env:ProgramData} "Microsoft\\Windows\Start Menu\Programs\BunKit App.lnk"))
$shortcut.TargetPath = Join-Path $installDir "BunKitApp.exe"
$shortcut.WorkingDirectory = $installDir
$shortcut.Save()
$uninstall = Join-Path $installDir "uninstall.ps1"
Set-Content $uninstall @(
  '$installDir = Join-Path ${env:ProgramFiles} "BunKitApp"'
  'Remove-Item (Join-Path ${env:ProgramData} "Microsoft\Windows\Start Menu\Programs\BunKit App.lnk") -Force -ErrorAction SilentlyContinue'
  'Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue'
  'Remove-Item "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BunKitApp" -Recurse -Force -ErrorAction SilentlyContinue'
)
New-Item -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BunKitApp" -Force | Out-Null
New-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BunKitApp" -Name DisplayName -Value "BunKit App" -Force | Out-Null
New-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BunKitApp" -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstall`"" -Force | Out-Null
Start-Process (Join-Path $installDir "BunKitApp.exe")
'@ | Set-Content "$stage\install.ps1"

$sed = Join-Path $env:TEMP "BunKitSetup.sed"
@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=Installation complete.
FriendlyName=BunKit App Setup
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
TargetName=$repoRoot\$OutDir\$Name-Setup.exe
FILE0="$Name.exe"
FILE1="winbridge.dll"
FILE2="Microsoft.WindowsAppRuntime.Bootstrap.dll"
FILE3="Microsoft.WindowsAppRuntime.1.7.msix"
FILE4="Microsoft.WindowsAppRuntime.DDLM.1.7.msix"
FILE5="Microsoft.WindowsAppRuntime.Singleton.1.7.msix"
FILE6="Microsoft.WindowsAppRuntime.Main.1.7.msix"
FILE7="install.ps1"
[SourceFiles]
SourceFiles0=$stage
[SourceFiles0]
$Name.exe=
winbridge.dll=
Microsoft.WindowsAppRuntime.Bootstrap.dll=
Microsoft.WindowsAppRuntime.1.7.msix=
Microsoft.WindowsAppRuntime.DDLM.1.7.msix=
Microsoft.WindowsAppRuntime.Singleton.1.7.msix=
Microsoft.WindowsAppRuntime.Main.1.7.msix=
install.ps1=
"@ | Set-Content $sed -Encoding ASCII
& $iexpress /N /Q $sed
if ($LASTEXITCODE -ne 0) { throw "iexpress failed" }
for ($attempt = 0; $attempt -lt 120 -and -not (Test-Path "$repoRoot\$OutDir\$Name-Setup.exe"); $attempt++) {
  Start-Sleep -Seconds 1
}
if (-not (Test-Path "$repoRoot\$OutDir\$Name-Setup.exe")) { throw "installer output was not created" }
Remove-Item $stage -Recurse -Force
Remove-Item $looseDir -Recurse -Force
Write-Host "Created $repoRoot\$OutDir\$Name-Setup.exe"
