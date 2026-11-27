set shell := ["powershell.exe", "-NoProfile", "-Command"]

version := `Get-Content VERSION -Raw | ForEach-Object { $_.Trim() }`

default:
    just --list

run:
    $env:CGO_ENABLED='0'; go run ./cmd/hesh-ups

build:
    if (-not (Test-Path dist)) { New-Item -ItemType Directory -Path dist | Out-Null }
    $env:CGO_ENABLED='0'; go build -ldflags "-X main.version={{version}}" -o dist/hesh-ups.exe ./cmd/hesh-ups

test:
    $env:CGO_ENABLED='0'; go vet ./...
    $env:CGO_ENABLED='0'; go test ./...

fmt:
    go fmt ./...

package: build
    @just verify-package

verify-package:
    if (-not (Test-Path dist/hesh-ups.exe)) { Write-Error "missing exe"; exit 1 }
    if (Test-Path dist/web) { Write-Error "dist/web must not exist"; exit 1 }

msi-only:
    if (-not (Get-Command wix -ErrorAction SilentlyContinue)) { Write-Error "wix not on PATH. Install: dotnet tool install -g wix"; exit 1 }
    $ver = (Get-Content VERSION -Raw).Trim(); $payload = (Resolve-Path dist).Path; wix build -wx -arch x64 -ext WixToolset.UI.wixext -b "payload=$payload" -d Version=$ver -o "dist/hesh-ups-$ver-win-x64.msi" packaging/hesh-ups.wxs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

msi: package
    @just msi-only

build-dist: package
    $ver = (Get-Content VERSION -Raw).Trim(); Compress-Archive -Path dist/hesh-ups.exe -DestinationPath "dist/hesh-ups-$ver-win-x64.zip" -Force
    @just msi-only

clean:
    go clean
    if (Test-Path dist) { Remove-Item -Recurse -Force dist }
