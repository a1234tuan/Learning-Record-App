$ErrorActionPreference = "Stop"

$jdkPath = "C:\Program Files\Java\jdk-21"
if (-not (Test-Path -LiteralPath "$jdkPath\bin\java.exe")) {
  throw "Firebase Emulator requires JDK 21 at $jdkPath."
}

$env:JAVA_HOME = $jdkPath
$env:PATH = "$jdkPath\bin;$env:PATH"
& "$PSScriptRoot\..\node_modules\.bin\firebase.cmd" emulators:exec `
  --project demo-noteproject-stage9 `
  --only firestore,storage `
  "vitest run --config vitest.firebase.config.ts"
exit $LASTEXITCODE
