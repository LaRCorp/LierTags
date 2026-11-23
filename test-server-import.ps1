# Test script to verify LierTags HTTP server and LierEX-Q import pipeline
$ErrorActionPreference = "Stop"

Write-Host "Checking LierTags server status at http://127.0.0.1:8766/api/status..." -ForegroundColor Cyan

try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/status" -Method Get
    Write-Host "Server is ONLINE!" -ForegroundColor Green
    $status | Format-List
} catch {
    Write-Host "Server is offline. Start 'liertags-app.exe' or 'cargo run -p liertags-cli -- serve' first." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nSending test track import payload (LierEX-Q simulation)..." -ForegroundColor Cyan
$payload = @{
    type = "track"
    title = "Resonance"
    artist = "HOME"
    album = "Odyssey"
    year = 2014
    genre = "Synthwave / Chillwave"
    artwork_url = "https://f4.bcbits.com/img/a1699741275_10.jpg"
    source_url = "https://midwestcollective.bandcamp.com/album/odyssey"
    track_number = 3
    comment = "Imported test from LierEX-Q simulator"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/import" -Method Post -ContentType "application/json" -Body $payload
Write-Host "Import Response:" -ForegroundColor Green
$response | Format-List
