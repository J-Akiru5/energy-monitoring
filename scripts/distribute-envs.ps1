$rootEnv = Join-Path $PSScriptRoot "..\.env"
$apps = @("apps\web", "apps\admin", "apps\mock-sensor")

if (-not (Test-Path $rootEnv)) {
    Write-Error "Root .env file not found at $rootEnv"
    exit 1
}

foreach ($app in $apps) {
    $targetDir = Join-Path $PSScriptRoot "..\$app"
    $targetEnv = Join-Path $targetDir ".env"
    
    if (Test-Path $targetDir) {
        Write-Host "Syncing .env to $app..."
        Copy-Item -Path $rootEnv -Destination $targetEnv -Force
    } else {
        Write-Warning "Directory $app not found, skipping sync."
    }
}

Write-Host "Environment variables synchronized successfully." -ForegroundColor Green
