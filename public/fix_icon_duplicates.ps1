$base = Join-Path $PSScriptRoot 'icons'
Write-Output "Fixing icons under: $base"

function MakeSafeRename($oldFullPath, $newFullPath) {
    if ($oldFullPath -ieq $newFullPath) { return $newFullPath }
    $dir = Split-Path $newFullPath -Parent
    $leaf = Split-Path $newFullPath -Leaf
    if (-not (Test-Path $newFullPath)) {
        try { Rename-Item -LiteralPath $oldFullPath -NewName $leaf -ErrorAction Stop; Write-Output "RENAMED: $oldFullPath -> $newFullPath"; return $newFullPath } catch { Write-Output "ERROR rename $oldFullPath -> $newFullPath : $_"; return $null }
    } else {
        # collision: append _1, _2
        $baseName = [IO.Path]::GetFileNameWithoutExtension($leaf)
        $ext = [IO.Path]::GetExtension($leaf)
        $i = 1
        do { $candidate = Join-Path $dir ($baseName + "_" + $i + $ext); $i++ } while (Test-Path $candidate)
        try { Rename-Item -LiteralPath $oldFullPath -NewName (Split-Path $candidate -Leaf) -ErrorAction Stop; Write-Output "RENAMED (collision): $oldFullPath -> $candidate"; return $candidate } catch { Write-Output "ERROR rename collision $oldFullPath -> $candidate : $_"; return $null }
    }
}

# Step 1: dedupe inside each directory by base name (strip trailing _number)
Get-ChildItem -Path $base -Recurse -Filter *.svg -File | Group-Object DirectoryName | ForEach-Object {
    $dir = $_.Name
    $files = $_.Group
    $map = @{}
    foreach ($f in $files) {
        $name = $f.BaseName
        $ext = $f.Extension
        if ($name -match '^(.*)_([0-9]+)$') { $key = $matches[1]; $suf = [int]$matches[2] } else { $key = $name; $suf = $null }
        if (-not $map.ContainsKey($key)) { $map[$key] = @() }
        $map[$key] += @{ file = $f; suf = $suf }
    }
    foreach ($key in $map.Keys) {
        $list = $map[$key]
        if ($list.Count -le 1) { continue }
        # choose keep: prefer file with no suffix; else lowest numeric suffix
        $keep = $null
        foreach ($item in $list) { if ($item.suf -eq $null) { $keep = $item; break } }
        if (-not $keep) { $sorted = $list | Sort-Object { $_.suf }; $keep = $sorted[0] }
        $keepFile = $keep.file
        $target = Join-Path $dir ($key + $keepFile.Extension)
        if ($keepFile.FullName -ne $target) { MakeSafeRename $keepFile.FullName $target } else { Write-Output "KEEP (already base): $($keepFile.FullName)" }
        foreach ($item in $list) {
            $f = $item.file
            if ($f.FullName -ieq $keepFile.FullName -or $f.FullName -ieq $target) { continue }
            try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; Write-Output "REMOVED duplicate: $($f.FullName)" } catch { Write-Output "ERROR removing $($f.FullName): $_" }
        }
    }
}

# Step 2: for files with the same name across different folders, prefix with parent folder name
$all = Get-ChildItem -Path $base -Recurse -Filter *.svg -File
$groups = $all | Group-Object Name
foreach ($g in $groups) {
    if ($g.Count -le 1) { continue }
    Write-Output "Handling cross-folder duplicates for: $($g.Name) (count: $($g.Count))"
    foreach ($f in $g.Group) {
        $parent = Split-Path $f.DirectoryName -Leaf
        $origBase = $f.BaseName
        $newBase = ($parent + $origBase)
        # sanitize: remove spaces and invalid chars
        $newBase = $newBase -replace '[\\/:*?"<>|\s]', ''
        $newName = $newBase + $f.Extension
        $newFull = Join-Path $f.DirectoryName $newName
        MakeSafeRename $f.FullName $newFull | Out-Null
    }
}

Write-Output "Done fix_icon_duplicates."
