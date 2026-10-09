param([string]$BuiltinDirectory = (Join-Path $PSScriptRoot 'assets\builtin'))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
function Get-AssetFileHash([string]$path) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($path)
  try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $hasher.Dispose() }
}
function Export-RuntimeTexture($archive, $map, [string]$key, [string]$directory) {
  $entry = $archive.GetEntry($map.path)
  $stream = [IO.MemoryStream]::new()
  $input = $entry.Open()
  try { $input.CopyTo($stream) } finally { $input.Dispose() }
  $image = $null; $bitmap = $null; $graphics = $null
  try {
    $stream.Position = 0
    try { $image = [Drawing.Image]::FromStream($stream) }
    catch {
      # GDI+ cannot decode WebP on all Windows installations.
      if ($map.type -ne 'image/webp') { throw '贴图无法解码' }
      $filename = $key + '.webp'
      [IO.File]::WriteAllBytes((Join-Path $directory $filename), $stream.ToArray())
      return [ordered]@{ url=$filename; name=$map.name; type='image/webp'; prepared=$false; bytes=$stream.Length }
    }
    if ([long]$image.Width * $image.Height -gt 100000000) { throw '贴图像素数超过 1 亿' }
    $scale = [Math]::Min([double]1, 2048.0 / [Math]::Max($image.Width, $image.Height))
    $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
    $jpeg = $map.type -eq 'image/jpeg' -and ($scale -eq 1 -or $key -in @('map','emissiveMap'))
    $extension = $(if ($jpeg) { '.jpg' } else { '.png' })
    $filename = $key + $extension
    $target = Join-Path $directory $filename
    if ($scale -eq 1 -and (($jpeg -and $map.type -eq 'image/jpeg') -or $map.type -eq 'image/png')) {
      [IO.File]::WriteAllBytes($target, $stream.ToArray())
    } else {
      $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $attributes = [Drawing.Imaging.ImageAttributes]::new()
      try {
        $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $graphics.DrawImage($image, [Drawing.Rectangle]::new(0,0,$width,$height), 0,0,$image.Width,$image.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
      } finally { $attributes.Dispose() }
      if ($jpeg) {
        $encoder = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $parameters = [Drawing.Imaging.EncoderParameters]::new(1)
        try {
          $parameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [long]90)
          $bitmap.Save($target, $encoder, $parameters)
        } finally { $parameters.Dispose() }
      } else { $bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png) }
    }
    return [ordered]@{ url=$filename; name=([IO.Path]::GetFileNameWithoutExtension([string]$map.name) + $extension); type=$(if ($jpeg) { 'image/jpeg' } else { 'image/png' }); prepared=$true; width=$width; height=$height; bytes=(Get-Item -LiteralPath $target).Length }
  } finally {
    if ($graphics) { $graphics.Dispose() }; if ($bitmap) { $bitmap.Dispose() }; if ($image) { $image.Dispose() }; $stream.Dispose()
  }
}
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
        $runtimeName = $version + '-2048-v2'
        $runtimeDirectory = Join-Path (Join-Path $BuiltinDirectory 'runtime') $runtimeName
        $runtimePath = Join-Path $runtimeDirectory 'material.json'
        if (-not [IO.File]::Exists($runtimePath)) {
          [IO.Directory]::CreateDirectory($runtimeDirectory) | Out-Null
          $runtimeMaps = [ordered]@{}
          foreach ($map in $meta.maps.PSObject.Properties) {
            if ($map.Name -notin @('map','normalMap','roughnessMap','metalnessMap','aoMap','bumpMap','emissiveMap')) { throw '不支持的贴图通道' }
            $runtimeMaps[$map.Name] = Export-RuntimeTexture $archive $map.Value $map.Name $runtimeDirectory
          }
          $runtime = [ordered]@{ format='SPENIC-MATERIAL-RUNTIME'; version=1; sourceVersion=$version; maps=$runtimeMaps }
          foreach ($field in @('name','description','designInfo','supplier','previewInfo','materialType','category','surface','physical','repeat','placement','density','legacyMaps')) { $runtime[$field] = $meta.$field }
          [IO.File]::WriteAllText($runtimePath, (ConvertTo-Json -InputObject $runtime -Depth 20) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        }
        $previewUrl = $null
        if ($meta.preview) {
          $previewEntry = $archive.GetEntry($meta.preview.path)
          $extensions = @{ 'image/png'='.png'; 'image/jpeg'='.jpg'; 'image/webp'='.webp'; 'image/bmp'='.bmp' }
          if (-not $previewEntry -or $previewEntry.Length -gt 16MB -or -not $extensions.ContainsKey([string]$meta.preview.type)) { throw '预览图缺失、格式无效或过大' }
          $previewDirectory = Join-Path $BuiltinDirectory 'previews'
          [IO.Directory]::CreateDirectory($previewDirectory) | Out-Null
          $previewName = $version + $extensions[[string]$meta.preview.type]
          $previewPath = Join-Path $previewDirectory $previewName
          if (-not [IO.File]::Exists($previewPath)) {
            $inputStream = $previewEntry.Open()
            $outputStream = [IO.File]::Create($previewPath)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
          }
          $previewUrl = './previews/' + $previewName
        }
        [ordered]@{
          id = $id
          name = $baseName
          category = $category
          materialType = $(if ($meta.materialType -eq 'pattern') { 'pattern' } else { 'fabric' })
          url = './' + [Uri]::EscapeDataString($file.Name)
          version = $version
          runtime = './runtime/' + $runtimeName + '/material.json'
          preview = $previewUrl
          previewInfo = $meta.previewInfo
          physical = $meta.physical
          surface = $meta.surface
          description = $meta.description
          designInfo = $meta.designInfo
          supplier = $meta.supplier
        }
      } catch { throw ('无法读取“' + $file.Name + '”：' + $_.Exception.Message + '。原清单未改动。') }
      finally { if ($archive) { $archive.Dispose() } }
    }
)
$items += @(
  Get-ChildItem -LiteralPath $BuiltinDirectory -File | Where-Object { $_.Extension -in @('.fbx','.glb') } | Sort-Object Name | ForEach-Object {
    $file = $_
    if ($file.Length -gt 512MB) { throw ('模型超过 512 MB：' + $file.Name) }
    $modelHash = Get-AssetFileHash $file.FullName
    $resources = @(); $resourceVersions = @()
    $resourceDirectory = $file.FullName + '.resources'
    if (Test-Path -LiteralPath $resourceDirectory -PathType Container) {
      $resources = @(Get-ChildItem -LiteralPath $resourceDirectory -File | Sort-Object Name | ForEach-Object {
        if ($_.Extension -notin @('.png','.jpg','.jpeg','.webp','.bmp','.ktx2','.bin') -or $_.Length -gt 64MB) { throw ('模型配套资源格式或大小无效：' + $_.Name) }
        $hash = Get-AssetFileHash $_.FullName
        $resourceVersions += $_.Name + ':' + $hash
        [ordered]@{ name=$_.Name; url='./' + [Uri]::EscapeDataString($file.Name + '.resources') + '/' + [Uri]::EscapeDataString($_.Name); version=$hash }
      })
    }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $version = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($modelHash + ($resourceVersions -join '|')))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
    $previewFile = $file.FullName + '.preview.png'
    [ordered]@{ id='builtin-model-' + $file.Name; kind='model'; name=$file.Name; url='./' + [Uri]::EscapeDataString($file.Name); version=$version; resources=$resources; preview=$(if (Test-Path -LiteralPath $previewFile) { './' + [Uri]::EscapeDataString($file.Name + '.preview.png') } else { $null }) }
  }
)
# Validate every package before replacing the manifest.
$json = ConvertTo-Json -InputObject @($items) -Depth 8
[IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host ('已更新内置素材清单，共 ' + $items.Count + ' 项。') -ForegroundColor Green
$items | ForEach-Object { Write-Host ('  ' + $_.name + ' [' + $_.materialType + ' / ' + $_.category + ']') }
Write-Host '刷新网页即可使用；线上使用请再运行“更新网站.bat”。'
