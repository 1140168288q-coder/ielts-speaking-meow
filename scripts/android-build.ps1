param(
    [switch] $RunDeviceTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolRoot = Join-Path $env:LOCALAPPDATA 'IeltsSpeakingMeow'
$JavaRoot = Join-Path $ToolRoot 'java'
$AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$BundledGradle = Join-Path $ToolRoot 'gradle\gradle-8.14.3\bin\gradle.bat'
$NodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$NpmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source

$Jdk = Get-ChildItem -LiteralPath $JavaRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-21*' } |
    Sort-Object Name -Descending |
    Select-Object -First 1

if (-not $Jdk) {
    throw "JDK 21 was not found under $JavaRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms\android-36'))) {
    throw "Android SDK platform 36 was not found under $AndroidSdk"
}

$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$NodeDirectory = Split-Path -Parent $NodeCommand
$env:JAVA_HOME = $Jdk.FullName
$env:ANDROID_HOME = $AndroidSdk
$env:Path = @(
    (Join-Path $Jdk.FullName 'bin')
    $NodeDirectory
    (Join-Path $AndroidSdk 'platform-tools')
    (Join-Path $AndroidSdk 'emulator')
    $MachinePath
) -join ';'

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

Push-Location $ProjectRoot
try {
    Invoke-Checked $NpmCommand run lint
    Invoke-Checked $NpmCommand test
    Invoke-Checked $NpmCommand run android:sync

    Push-Location (Join-Path $ProjectRoot 'android')
    try {
        if (Test-Path -LiteralPath $BundledGradle) {
            Invoke-Checked $BundledGradle --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
            if ($RunDeviceTests) {
                Invoke-Checked $BundledGradle --no-daemon :app:connectedDebugAndroidTest
            }
        } else {
            Invoke-Checked (Join-Path $ProjectRoot 'android\gradlew.bat') --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
            if ($RunDeviceTests) {
                Invoke-Checked (Join-Path $ProjectRoot 'android\gradlew.bat') --no-daemon :app:connectedDebugAndroidTest
            }
        }
    } finally {
        Pop-Location
    }

    $SourceApk = Join-Path $ProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    $ArtifactDirectory = Join-Path $ProjectRoot 'artifacts'
    $ArtifactApk = Join-Path $ArtifactDirectory 'ielts-speaking-meow-v1.0-debug.apk'
    New-Item -ItemType Directory -Force -Path $ArtifactDirectory | Out-Null
    Copy-Item -LiteralPath $SourceApk -Destination $ArtifactApk -Force
    $Hash = (Get-FileHash -LiteralPath $ArtifactApk -Algorithm SHA256).Hash.ToLowerInvariant()

    Write-Host "APK: $ArtifactApk"
    Write-Host "SHA256: $Hash"
} finally {
    Pop-Location
}
