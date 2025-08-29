# Generate a manifest.json listing SVG files under each top-level folder (AWS, Azure, GCP)
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$folders = Get-ChildItem -Path $root -Directory | Where-Object { $_.Name -in @('AWS','Azure','GCP') }
$manifest = @{}
foreach ($f in $folders) {
    $files = Get-ChildItem -Path $f.FullName -Recurse -Filter *.svg | ForEach-Object {
        # produce a relative path from public
        $rel = Join-Path (Split-Path -Leaf (Split-Path -Parent $f.FullName)) $_.FullName
        # better: produce web-friendly relative from public/icons
        $rel = $_.FullName.Substring($root.Length+1).Replace('\','/')
        $rel
    }
    $manifest[$f.Name] = $files
}
$manifestJson = $manifest | ConvertTo-Json -Depth 10
Set-Content -Path (Join-Path $root 'manifest.json') -Value $manifestJson -Encoding UTF8
Write-Output "Manifest written to: $(Join-Path $root 'manifest.json')"
