param([string]$BuiltinDirectory = (Join-Path $PSScriptRoot 'assets\builtin'))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifestPath = Join-Path $BuiltinDirectory 'manifest.json'
if (-not (Test-Path -LiteralPath $BuiltinDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $BuiltinDirectory -Force | Out-Null
}
# Preserve IDs from the original release.
$originalIds = @{
  '测试刺绣' = 'builtin-test-embroidery'
  '测试面布' = 'builtin-test-fabric'
  '测试边布' = 'builtin-test-edge-fabric'
  '测试包边条' = 'builtin-test-piping'
}
$items = @(
  Get-ChildItem -LiteralPath $BuiltinDirectory -Filter '*.formmat' -File |
    Sort-Object Name | ForEach-Object {
      $file = $_
      $baseName = [IO.Path]::GetFileNameWithoutExtension($file.Name)
      $archive = $null
      try {
        if ($file.Length -gt 512MB) { throw '材质包超过 512 MB' }
        $archive = [IO.Compression.ZipFile]::OpenRead($file.FullName)
        $entry = $archive.GetEntry('material.json')
        if (-not $entry -or $entry.Length -gt 1MB) { throw '缺少有效的 material.json' }
        $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
        try { $meta = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($meta.format -ne 'SPENIC-MATERIAL' -or $meta.version -ne 1 -or -not $meta.surface) { throw '不是有效的 Spenic 材质包' }
        foreach ($map in $meta.maps.PSObject.Properties) {
          $texture = $archive.GetEntry($map.Value.path)
          if (-not $texture -or $texture.Length -gt 64MB) { throw ('贴图缺失或过大：' + $map.Name) }
        }
        $category = $meta.category
        if ($baseName -match '包边|滚边|piping|binding') { $category = '包边条' }
        elseif ($baseName -match '边布|侧布|edge|side') { $category = '边布' }
        elseif ($baseName -match '面布') { $category = '面布' }
        if ($category -notin @('面布','边布','包边条','其他')) { $category = '其他' }
        $id = 'builtin-' + $baseName
        if ($originalIds.ContainsKey($baseName)) { $id = $originalIds[$baseName] }
        $hasher = [Security.Cryptography.SHA256]::Create()
        $stream = [IO.File]::OpenRead($file.FullName)
        try { $version = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $hasher.Dispose() }
        [ordered]@{
          id = $id
          name = $baseName
          category = $category
          materialType = $(if ($meta.materialType -eq 'pattern') { 'pattern' } else { 'fabric' })
          url = './' + [Uri]::EscapeDataString($file.Name)
          version = $version
        }
      } catch { throw ('无法读取“' + $file.Name + '”：' + $_.Exception.Message + '。原清单未改动。') }
      finally { if ($archive) { $archive.Dispose() } }
    }
)
# Validate every package before replacing the manifest.
$json = ConvertTo-Json -InputObject @($items) -Depth 4
[IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host ('已更新内置素材清单，共 ' + $items.Count + ' 项。') -ForegroundColor Green
$items | ForEach-Object { Write-Host ('  ' + $_.name + ' [' + $_.materialType + ' / ' + $_.category + ']') }
Write-Host '刷新网页即可使用；线上使用请再运行“更新网站.bat”。'
