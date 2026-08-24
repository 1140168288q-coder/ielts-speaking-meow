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
    $candidate = $HostName.Trim().ToLowerInvariant()
    if (
        $candidate -eq 'localhost' -or
        $candidate -eq '::1' -or
        $candidate.EndsWith('.local')
    ) {
        return $true
    }

    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($candidate, [ref] $address)) {
        return $false
    }
    if ($address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        return [System.Net.IPAddress]::IsLoopback($address)
    }

    $bytes = $address.GetAddressBytes()
    return (
        $bytes[0] -eq 10 -or
        $bytes[0] -eq 127 -or
        ($bytes[0] -eq 169 -and $bytes[1] -eq 254) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or
        ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31)
    )
}

function ConvertTo-BackendBaseUrl([string] $Value) {
    $candidate = $Value.Trim()
    $parsed = $null
    if (
        [string]::IsNullOrWhiteSpace($candidate) -or
        -not [System.Uri]::TryCreate(
            $candidate,
            [System.UriKind]::Absolute,
            [ref] $parsed
        )
    ) {
        throw "Backend 地址不是有效的绝对 URL: $Value"
    }
    if ($parsed.Scheme -notin @('https', 'http') -or [string]::IsNullOrWhiteSpace($parsed.Host)) {
        throw 'Backend 地址只支持 HTTP 或 HTTPS。'
    }
    if (
        -not [string]::IsNullOrEmpty($parsed.UserInfo) -or
        -not [string]::IsNullOrEmpty($parsed.Query) -or
        -not [string]::IsNullOrEmpty($parsed.Fragment)
    ) {
        throw 'Backend 地址不能包含账号、密码、查询参数或片段。'
    }

    $path = $parsed.AbsolutePath.TrimEnd('/')
    if ($path.Length -gt 0 -and $path -ine '/health') {
        throw 'Backend 地址只能填写服务根地址；允许自动移除末尾的 /health。'
    }
    return $parsed.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

$LockBackendUrl = $Release
$AllowLanHttpBuild = $false
$Normalized = if ([string]::IsNullOrWhiteSpace($BackendUrl)) {
    ''
} else {
    ConvertTo-BackendBaseUrl $BackendUrl
}

if ($Normalized.Length -gt 0) {
    $Uri = [System.Uri]::new($Normalized)
    $IsPrivateHttp = (
        $Uri.Scheme -eq 'http' -and
        (Test-PrivateLanHost $Uri.Host)
    )
    if ($Uri.Scheme -eq 'http' -and -not $IsPrivateHttp) {
        throw "公网 Backend 地址必须使用 HTTPS（当前：$Normalized）。"
    }
    if ($Release -and $IsPrivateHttp -and -not $AllowLanHttp) {
        throw '正式构建使用私有局域网 HTTP 时必须显式开启 -AllowLanHttp。'
    }
    $AllowLanHttpBuild = $Release -and $IsPrivateHttp -and $AllowLanHttp
}

if ($Release) {
    Write-Host "Release build will lock Backend URL: $Normalized"
} elseif ($Normalized.Length -gt 0) {
    Write-Host "Debug build will default Backend URL to: $Normalized (still editable)"
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

function Get-Sha256Hex([string] $Path) {
    $Stream = [System.IO.File]::OpenRead($Path)
    $Algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Bytes = $Algorithm.ComputeHash($Stream)
        return ([System.BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $Algorithm.Dispose()
        $Stream.Dispose()
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
    $Hash = Get-Sha256Hex $ArtifactApk

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
        $ReleaseHash = Get-Sha256Hex $ArtifactReleaseApk
        Write-Host "RELEASE APK: $ArtifactReleaseApk"
        Write-Host "RELEASE SHA256: $ReleaseHash"
    }
} finally {
    Pop-Location
}
