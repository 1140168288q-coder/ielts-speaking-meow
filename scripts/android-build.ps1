param(
    [switch] $RunDeviceTests,
    [switch] $Release,
    [string] $BackendUrl = '',
    [switch] $AllowLanHttp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Package = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json
$AppVersion = [string] $Package.version
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
if ($Release -and -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'android\keystore.properties'))) {
    throw 'Release signing is not configured. Create android/keystore.properties before building a formal APK.'
}
if ($Release -and [string]::IsNullOrWhiteSpace($BackendUrl)) {
    throw '正式构建必须提供 Backend 地址:android-build.ps1 -Release -BackendUrl https://...'
}

function Test-PrivateLanHost([string] $HostName) {
    $candidate = $HostName.ToLowerInvariant()
    if ($candidate -eq 'localhost' -or $candidate -eq '::1' -or $candidate.EndsWith('.local')) {
        return $true
    }
    foreach ($pattern in @('^10\.', '^127\.', '^169\.254\.', '^192\.168\.', '^172\.(1[6-9]|2\d|3[01])\.')) {
        if ($candidate -match $pattern) {
            return $true
        }
    }
    return $false
}

if ($Release) {
    $Normalized = $BackendUrl.Trim().TrimEnd('/') -replace '/health$', ''
    $Uri = [System.Uri]::new($Normalized)
    $LockBackendUrl = $false
    $AllowLanHttpBuild = $false
    if ($Uri.Scheme -eq 'https') {
        $LockBackendUrl = $true
    } elseif ($Uri.Scheme -eq 'http' -and $AllowLanHttp -and (Test-PrivateLanHost $Uri.Host)) {
        # 家庭 Backend 过渡方案:私有局域网 HTTP 需要显式 -AllowLanHttp
        $LockBackendUrl = $true
        $AllowLanHttpBuild = $true
    } else {
        throw "正式构建的 Backend 地址必须是 HTTPS(当前:$Normalized);私有局域网 HTTP 例外需显式开启 -AllowLanHttp。"
    }
    Write-Host "Release build will lock Backend URL: $Normalized"
} else {
    $LockBackendUrl = $false
    $AllowLanHttpBuild = $false
    $Normalized = if ([string]::IsNullOrWhiteSpace($BackendUrl)) { '' } else { $BackendUrl.Trim().TrimEnd('/') }
    if ($Normalized.Length -gt 0) {
        Write-Host "Debug build will default Backend URL to: $Normalized (still editable)"
    }
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
    Invoke-Checked $NpmCommand run test:backend
    # VITE_* 变量只影响 Web 构建,必须在 lint/测试跑完之后才注入进程环境
    if ($LockBackendUrl) {
        $env:VITE_BACKEND_URL = $Normalized
        $env:VITE_LOCK_BACKEND_URL = 'true'
        if ($AllowLanHttpBuild) {
            $env:VITE_ALLOW_LAN_HTTP = 'true'
        }
        Write-Host "Building web assets with locked Backend URL: $Normalized"
    } elseif ($Normalized.Length -gt 0) {
        # Debug 构建注入默认地址但保持可编辑(便于真机连局域网 Backend)
        $env:VITE_BACKEND_URL = $Normalized
        $env:VITE_LOCK_BACKEND_URL = $null
        $env:VITE_ALLOW_LAN_HTTP = $null
        Write-Host "Building web assets with editable Backend URL default: $Normalized"
    }
    Invoke-Checked $NpmCommand run android:sync

    Push-Location (Join-Path $ProjectRoot 'android')
    try {
        if (Test-Path -LiteralPath $BundledGradle) {
            Invoke-Checked $BundledGradle --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
            if ($RunDeviceTests) {
                Invoke-Checked $BundledGradle --no-daemon :app:connectedDebugAndroidTest
            }
            if ($Release) {
                Invoke-Checked $BundledGradle --no-daemon :app:assembleRelease
            }
        } else {
            Invoke-Checked (Join-Path $ProjectRoot 'android\gradlew.bat') --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
            if ($RunDeviceTests) {
                Invoke-Checked (Join-Path $ProjectRoot 'android\gradlew.bat') --no-daemon :app:connectedDebugAndroidTest
            }
            if ($Release) {
                Invoke-Checked (Join-Path $ProjectRoot 'android\gradlew.bat') --no-daemon :app:assembleRelease
            }
        }
    } finally {
        Pop-Location
    }

    $SourceApk = Join-Path $ProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    $ArtifactDirectory = Join-Path $ProjectRoot 'artifacts'
    $ArtifactApk = Join-Path $ArtifactDirectory "ielts-speaking-meow-v$AppVersion-debug.apk"
    New-Item -ItemType Directory -Force -Path $ArtifactDirectory | Out-Null
    Copy-Item -LiteralPath $SourceApk -Destination $ArtifactApk -Force
    $Hash = (Get-FileHash -LiteralPath $ArtifactApk -Algorithm SHA256).Hash.ToLowerInvariant()

    Write-Host "APK: $ArtifactApk"
    Write-Host "SHA256: $Hash"

    if ($Release) {
        $SourceReleaseApk = Join-Path $ProjectRoot 'android\app\build\outputs\apk\release\app-release.apk'
        $ArtifactReleaseApk = Join-Path $ArtifactDirectory "ielts-speaking-meow-v$AppVersion-release.apk"
        Copy-Item -LiteralPath $SourceReleaseApk -Destination $ArtifactReleaseApk -Force
        $ApkSigner = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'build-tools') -Directory |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        if (-not $ApkSigner) {
            throw 'apksigner.bat was not found; refusing to publish an unverified Release APK.'
        }
        Invoke-Checked $ApkSigner verify --verbose --print-certs $ArtifactReleaseApk
        $ReleaseHash = (Get-FileHash -LiteralPath $ArtifactReleaseApk -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Host "RELEASE APK: $ArtifactReleaseApk"
        Write-Host "RELEASE SHA256: $ReleaseHash"
    }
} finally {
    Pop-Location
}
