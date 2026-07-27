param(
    [switch]$NoRestore
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $repositoryRoot "src-overlay\Desktop Image Overlay\Desktop Image Overlay.csproj"
$outputPath = Join-Path $repositoryRoot "src-tauri\desktopoverlay"

$publishArguments = @(
    "publish",
    $projectPath,
    "--configuration", "Release",
    "--runtime", "win-x64",
    "--self-contained", "true",
    "--property:PublishSingleFile=false",
    "--output", $outputPath
)

if ($NoRestore) {
    $publishArguments += "--no-restore"
}

dotnet @publishArguments
if ($LASTEXITCODE -ne 0) {
    throw "Desktop overlay publish failed with exit code $LASTEXITCODE."
}

$overlayExecutable = Join-Path $outputPath "Desktop Image Overlay.exe"
if (-not (Test-Path -LiteralPath $overlayExecutable)) {
    throw "Desktop overlay executable was not produced at $overlayExecutable."
}

Write-Host "Desktop overlay published to $outputPath"
