$ErrorActionPreference = "Stop"

$jdk = "C:\Program Files\Java\jdk-21"
if (-not (Test-Path (Join-Path $jdk "bin\java.exe"))) {
  throw "JDK 21 not found at $jdk. Install JDK 21 or update scripts/android-release-build.ps1."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Join-Path $repoRoot "android"
$keystoreProperties = Join-Path $androidRoot "keystore.properties"

if (-not (Test-Path $keystoreProperties)) {
  throw "Missing android\keystore.properties. Create a release keystore before building a release APK."
}

$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"
$env:GRADLE_OPTS = "-Dhttps.protocols=TLSv1.2,TLSv1.3 -Djava.net.preferIPv4Stack=true $env:GRADLE_OPTS"

Push-Location $androidRoot
try {
  .\gradlew.bat assembleRelease
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

$sourceApk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $sourceApk)) {
  throw "Release APK was not created at $sourceApk."
}

$releaseDir = Join-Path $repoRoot "dev-dist\release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$targetApk = Join-Path $releaseDir "学习日志.apk"
Copy-Item -Force -Path $sourceApk -Destination $targetApk

$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha256.ComputeHash([System.IO.File]::ReadAllBytes($targetApk))
  $hashValue = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "")
} finally {
  $sha256.Dispose()
}
$hashValue | Set-Content -Encoding ASCII -Path "$targetApk.sha256"

Write-Host "Release APK: $targetApk"
Write-Host "SHA256: $hashValue"
