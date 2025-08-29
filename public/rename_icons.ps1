$base = Join-Path $PSScriptRoot 'icons'
Write-Output "Base icons dir: $base"

function MakeSafeRename($oldPath, $newPath) {
    if ($oldPath -eq $newPath) { return }
    $dir = Split-Path $oldPath -Parent
    $leaf = Split-Path $newPath -Leaf
    if (-not (Test-Path $newPath)) {
        try {
            Rename-Item -LiteralPath $oldPath -NewName $leaf -ErrorAction Stop
            Write-Output "RENAMED: $oldPath -> $newPath"
        } catch {
            Write-Output "ERROR renaming $oldPath -> $newPath : $_"
        }
    } else {
        # collision: append _1, _2 ...
        $baseName = [IO.Path]::GetFileNameWithoutExtension($leaf)
        $ext = [IO.Path]::GetExtension($leaf)
        $i = 1
        do {
            $candidate = Join-Path $dir ($baseName + "_" + $i + $ext)
            $i++
        } while (Test-Path $candidate)
        $newLeaf = Split-Path $candidate -Leaf
        try {
            Rename-Item -LiteralPath $oldPath -NewName $newLeaf -ErrorAction Stop
            Write-Output "RENAMED (collision): $oldPath -> $candidate"
        } catch {
            Write-Output "ERROR renaming (collision) $oldPath -> $candidate : $_"
        }
    }
}

# AWS & GCP: remove hyphens from basename
foreach ($sub in @('AWS','GCP')) {
    $d = Join-Path $base $sub
    if (-not (Test-Path $d)) { Write-Output "Skipping missing $d"; continue }
    Get-ChildItem -Path $d -Recurse -Filter *.svg -File | ForEach-Object {
        $dir = $_.DirectoryName
        $name = $_.BaseName
        $ext = $_.Extension
        $newName = ($name -replace '-', '')
        $newPath = Join-Path $dir ($newName + $ext)
        MakeSafeRename $_.FullName $newPath
    }
}

# Azure: remove leading numbers and leading 'icon-' then remove hyphens; join parts; first part lowercased
$dAzure = Join-Path $base 'Azure'
if (Test-Path $dAzure) {
    Get-ChildItem -Path $dAzure -Recurse -Filter *.svg -File | ForEach-Object {
        $dir = $_.DirectoryName
        $name = $_.BaseName
        $ext = $_.Extension
        # strip leading numbers followed by hyphen(s)
        $s = $name -replace '^[0-9]+-+', ''
        # strip leading 'icon-' if present
        $s = $s -replace '^icon-', ''
        # split on hyphen or space
        $parts = $s -split '[- ]'
        $parts = $parts | Where-Object { $_ -ne '' }
        if ($parts.Count -ge 1) {
            $first = $parts[0].ToLower()
            if ($parts.Count -gt 1) {
                $rest = $parts[1..($parts.Count - 1)] -join ''
            } else { $rest = '' }
            $newName = $first + $rest
        } else {
            $newName = ($s -replace '[- ]', '')
        }
        # remove any characters invalid for filenames (safety)
        $newName = $newName -replace '[\\/:*?"<>|]', ''
        $newPath = Join-Path $dir ($newName + $ext)
        MakeSafeRename $_.FullName $newPath
    }
} else {
    Write-Output "Azure path not found: $dAzure"
}

Write-Output "Done."
