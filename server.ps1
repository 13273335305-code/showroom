param([int]$Port=4186,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
$partsViewFile=Join-Path $root 'parts-default-view.json'
$designViewFile=Join-Path $root 'design-default-view.json'
$fabricColorsFile=Join-Path $root 'fabric-colors.json'
$sceneConfigFile=Join-Path $root 'scene-config.json'
. (Join-Path $root 'utils/capture-ai-proxy.ps1')
function Read-FabricColors([string]$json){
 if(-not $json.TrimStart().StartsWith('[')){throw 'Invalid color list'}
 # Validate standalone JSON, then preserve arrays as a property on both PS versions.
 $null=ConvertFrom-Json -InputObject $json
 $value=(ConvertFrom-Json -InputObject ('{"colors":'+$json+'}')).colors
 if($value -isnot [Array]){throw 'Invalid color list'}
 if($value.Count -gt 500){throw 'Invalid color list'}
 $seen=@{};$result=@()
 foreach($item in $value){
  if($item.code -isnot [string] -or $item.code -cnotmatch '^[A-Z]{3}$' -or $seen.ContainsKey($item.code)){throw 'Invalid or duplicate color code'}
  if($item.base -isnot [string] -or $item.base -notmatch '^#[0-9a-f]{6}$' -or $item.line -isnot [string] -or $item.line -notmatch '^#[0-9a-f]{6}$'){throw 'Invalid HEX color'}
  $seen[$item.code]=$true;$result+=@{code=$item.code;base=$item.base.ToLowerInvariant();line=$item.line.ToLowerInvariant()}
 }
 return ,$result
}
function Save-FabricColors($value){
 $content=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $value -Depth 5))
 $temporary=$fabricColorsFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{
  [IO.File]::WriteAllBytes($temporary,$content)
  if(-not [IO.File]::Exists($fabricColorsFile)){[IO.File]::Move($temporary,$fabricColorsFile);return}
  try{[IO.File]::Replace($temporary,$fabricColorsFile,[NullString]::Value);return}
  catch [UnauthorizedAccessException],[IO.IOException]{
   # Some Windows folders allow writing the file but deny replacing its metadata.
   # Preserve that file's identity and permissions, and lock it during the update.
   $target=$null;$previous=$null
   try{
    $target=[IO.File]::Open($fabricColorsFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $previous=New-Object byte[] ([int]$target.Length)
    $offset=0
    while($offset -lt $previous.Length){$count=$target.Read($previous,$offset,$previous.Length-$offset);if($count -le 0){throw 'Incomplete configuration backup'};$offset+=$count}
    try{
     $target.Position=0;$target.Write($content,0,$content.Length);$target.SetLength($content.Length);$target.Flush($true)
    }catch{
     $failure=$_
     $target.Position=0;$target.Write($previous,0,$previous.Length);$target.SetLength($previous.Length);$target.Flush($true)
     throw $failure
    }
   }finally{if($target){$target.Dispose()}}
  }
 }finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}
function Read-SceneConfig($value){
 if($value.format -cne 'SPENIC-SCENE-SET' -or $value.version -ne 1 -or $value.defaultScene -notin @('morning','evening','night')){throw 'Invalid scene config format'}
 $scenes=@{}
 foreach($id in @('morning','evening','night')){
  $item=$value.scenes.$id;$scene=$item.scene
  if($null -eq $item -or $item.name -isnot [string] -or [string]::IsNullOrWhiteSpace($item.name) -or $item.name.Length -gt 80){throw 'Invalid scene name'}
  if($null -ne $item.filename -and ($item.filename -isnot [string] -or $item.filename.Length -gt 255 -or $item.filename -match '[\x00-\x1F]')){throw 'Invalid scene filename'}
  if($null -eq $scene -or $scene.preset -notin @('studio','daylight','night')){throw 'Invalid scene preset'}
  $lightElevation=if($scene.PSObject.Properties.Name -contains 'lightElevation'){$scene.lightElevation}else{[Math]::Atan2(7.5,7)*180/[Math]::PI}
  foreach($key in @('exposure','environment','keyLight','lightAngle','lightElevation','fillLight')){
   $number=if($key -eq 'lightElevation'){$lightElevation}else{$scene.$key}
   if($number -isnot [ValueType] -or $number -is [bool] -or [double]::IsNaN([double]$number) -or [double]::IsInfinity([double]$number)){throw 'Invalid scene number'}
  }
  if($scene.exposure -lt .2 -or $scene.exposure -gt 2.5 -or $scene.environment -lt 0 -or $scene.environment -gt 3 -or $scene.keyLight -lt 0 -or $scene.keyLight -gt 8 -or $scene.lightAngle -lt -180 -or $scene.lightAngle -gt 180 -or $lightElevation -lt 0 -or $lightElevation -gt 90 -or $scene.fillLight -lt 0 -or $scene.fillLight -gt 5){throw 'Scene parameter out of range'}
  foreach($key in @('backgroundColor','lightColor')){if($scene.$key -isnot [string] -or $scene.$key -notmatch '^#[0-9a-fA-F]{6}$'){throw 'Invalid scene color'}}
  foreach($key in @('shadows','reflection','floorVisible','grid')){if($scene.$key -isnot [bool]){throw 'Invalid scene switch'}}
  $filename=if($null -eq $item.filename){''}else{$item.filename.Trim().Split([char[]]@('/', '\\'))[-1]}
  $scenes[$id]=@{name=$item.name.Trim().Substring(0,[Math]::Min(80,$item.name.Trim().Length));filename=$filename;scene=@{preset=$scene.preset;backgroundColor=$scene.backgroundColor;exposure=$scene.exposure;environment=$scene.environment;keyLight=$scene.keyLight;lightAngle=$scene.lightAngle;lightElevation=$lightElevation;lightColor=$scene.lightColor;fillLight=$scene.fillLight;shadows=$scene.shadows;reflection=$scene.reflection;floorVisible=$scene.floorVisible;grid=$scene.grid}}
 }
 return @{format='SPENIC-SCENE-SET';version=1;defaultScene=$value.defaultScene;scenes=$scenes}
}
function Save-SceneConfig($value){
 $content=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $value -Depth 8))
 $temporary=$sceneConfigFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{[IO.File]::WriteAllBytes($temporary,$content);if([IO.File]::Exists($sceneConfigFile)){[IO.File]::Replace($temporary,$sceneConfigFile,[NullString]::Value)}else{[IO.File]::Move($temporary,$sceneConfigFile)}}finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}
function Read-PartsView($value){
 if($value.format -cne 'SPENIC-MODEL-VIEW' -or $value.version -ne 1){throw 'Invalid view file format'}
 $view=$value.view
 foreach($key in @('azimuth','elevation','framing')){
  $number=$view.$key
  if($number -isnot [ValueType] -or $number -is [bool] -or [double]::IsNaN([double]$number) -or [double]::IsInfinity([double]$number)){throw 'Invalid view number'}
 }
 if($view.azimuth -lt -180 -or $view.azimuth -gt 180 -or $view.elevation -lt 0 -or $view.elevation -gt 90 -or $view.framing -le 0 -or $view.framing -gt 1000){throw 'View parameters out of range'}
 if($view.offset -isnot [Array] -or $view.offset.Count -ne 3){throw 'Invalid view offset'}
 foreach($number in $view.offset){
  if($number -isnot [ValueType] -or $number -is [bool] -or [double]::IsNaN([double]$number) -or [double]::IsInfinity([double]$number) -or [Math]::Abs([double]$number) -gt 1000){throw 'Invalid view offset'}
 }
 return @{format='SPENIC-MODEL-VIEW';version=1;view=@{azimuth=$view.azimuth;elevation=$view.elevation;framing=$view.framing;offset=@($view.offset)}}
}
function Read-DesignView($value){
 if($value.format -cne 'SPENIC-DESIGN-VIEW' -or $value.version -ne 1){throw 'Invalid design view file format'}
 $view=$value.view
 foreach($key in @('azimuth','elevation','framing')){
  $number=$view.$key
  if($number -isnot [ValueType] -or $number -is [bool] -or [double]::IsNaN([double]$number) -or [double]::IsInfinity([double]$number)){throw 'Invalid design view number'}
 }
 if($view.azimuth -lt -180 -or $view.azimuth -gt 180 -or $view.elevation -lt 0 -or $view.elevation -gt 89 -or $view.framing -lt .5 -or $view.framing -gt 3){throw 'Design view parameters out of range'}
 if($null -ne $view.distance){
  if($view.distance -isnot [ValueType] -or $view.distance -is [bool] -or [double]::IsNaN([double]$view.distance) -or [double]::IsInfinity([double]$view.distance) -or $view.distance -le 0 -or $view.distance -gt 1000){throw 'Invalid design view distance'}
 }
 if($view.offset -isnot [Array] -or $view.offset.Count -ne 3){throw 'Invalid design view offset'}
 foreach($number in $view.offset){
  if($number -isnot [ValueType] -or $number -is [bool] -or [double]::IsNaN([double]$number) -or [double]::IsInfinity([double]$number) -or [Math]::Abs([double]$number) -gt 1000){throw 'Invalid design view offset'}
 }
 return @{format='SPENIC-DESIGN-VIEW';version=1;view=@{azimuth=$view.azimuth;elevation=$view.elevation;framing=$view.framing;distance=$view.distance;offset=@($view.offset)}}
}
$listener=$null
for($candidate=$Port;$candidate -lt $Port+20;$candidate++){
 try {
  $probe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/__form_health" -TimeoutSec 1
  if($probe.Content -eq $root){
   $viewProbe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/__form_parts_view" -TimeoutSec 1
   $designViewProbe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/__form_design_view" -TimeoutSec 1
   $colorsProbe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/__form_fabric_colors" -TimeoutSec 1
   $sceneProbe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/__form_scene_config" -TimeoutSec 1
   $aiProbe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/api/capture-ai" -TimeoutSec 1
   if($viewProbe.StatusCode -eq 200 -and $designViewProbe.StatusCode -eq 200 -and $colorsProbe.StatusCode -eq 200 -and $sceneProbe.StatusCode -eq 200 -and $aiProbe.Content -eq '{"ready":true}'){if(-not $NoBrowser){Start-Process "http://127.0.0.1:$candidate/"};exit 0}
  }
 }catch{}
 try{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$candidate);$listener.Start();$Port=$candidate;break}catch{$listener=$null}
}
if(-not $listener){throw 'No available local port. Please close another server and try again.'}
$url="http://127.0.0.1:$Port/"
$Host.UI.RawUI.WindowTitle='FORM Material Studio - close this window to stop'
Write-Host "FORM Material Studio is running at $url"
Write-Host 'Keep this window open. Close it to stop the local server.'
if(-not $NoBrowser){Start-Process $url}
$mime=@{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.json'='application/json';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.webp'='image/webp';'.svg'='image/svg+xml';'.fbx'='application/octet-stream';'.glb'='model/gltf-binary';'.ktx2'='application/octet-stream';'.wasm'='application/wasm';'.formmat'='application/zip';'.ico'='image/x-icon'}
try{
 while($true){
  $client=$listener.AcceptTcpClient();$client.ReceiveTimeout=5000;$client.SendTimeout=30000
  $stream=$null;$fileStream=$null
  try{
   # Latin-1 keeps one character per byte when reading Content-Length bodies.
   $stream=$client.GetStream();$wireEncoding=[Text.Encoding]::GetEncoding(28591);$reader=[IO.StreamReader]::new($stream,$wireEncoding,$false,1024,$true)
   $request=$reader.ReadLine();if(-not $request){continue};$parts=$request.Split(' ')
   $headers=@{};$headerSize=0
   while($line=$reader.ReadLine()){$headerSize+=$line.Length;if($headerSize -gt 16384){throw 'Request headers too large'};$colon=$line.IndexOf(':');if($colon -gt 0){$headers[$line.Substring(0,$colon).Trim()]=$line.Substring($colon+1).Trim()}}
   $method=$parts[0];$path=[Uri]::UnescapeDataString(($parts[1] -split '\?')[0]);$status='200 OK';$type='text/plain; charset=utf-8';$bytes=$null;$cacheControl='no-store';$cacheHeaders=''
   if($path -eq '/api/capture-ai'){
    $type='application/json; charset=utf-8'
    if($method -eq 'GET'){$bytes=[Text.Encoding]::UTF8.GetBytes('{"ready":true}')}
    elseif($method -eq 'POST'){
     $bodyLength=0;$validLength=[int]::TryParse($headers['Content-Length'],[ref]$bodyLength);$allowedOrigin=$true
     if($headers['Origin']){try{$origin=[Uri]$headers['Origin'];$allowedOrigin=$origin.Scheme -eq 'http' -and $origin.Authority -eq $headers['Host']}catch{$allowedOrigin=$false}}
     if(-not $allowedOrigin){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":{"message":"请求来源无效"}}')}
     elseif($headers['Content-Type'] -notmatch '^application/json(?:\s*;|$)'){$status='415 Unsupported Media Type';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":{"message":"请求须使用 JSON"}}')}
     elseif(-not $validLength -or $bodyLength -le 0 -or $bodyLength -gt 4194304 -or $headers['Transfer-Encoding']){$status='413 Payload Too Large';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":{"message":"参考图过大，请降低拍摄尺寸后重试"}}')}
     else{
      $body=New-Object char[] $bodyLength;$read=0
      while($read -lt $bodyLength){$count=$reader.Read($body,$read,$bodyLength-$read);if($count -le 0){throw 'Incomplete AI request body'};$read+=$count}
      $text=[Text.Encoding]::UTF8.GetString($wireEncoding.GetBytes((-join $body)))
      $reply=Invoke-CaptureAiProxy $text $headers['Authorization'] $root
      $bytes=$reply.Bytes
      $reason=@{200='OK';400='Bad Request';401='Unauthorized';403='Forbidden';404='Not Found';413='Payload Too Large';429='Too Many Requests';500='Internal Server Error';502='Bad Gateway';503='Service Unavailable';504='Gateway Timeout'}
      $phrase=$reason[[int]$reply.Code];if(-not $phrase){$phrase='AI Response'}
      $status=([string]$reply.Code)+' '+$phrase
     }
    }else{$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":{"message":"只支持 POST 请求"}}')}
   }
   elseif($path -eq '/__form_parts_view'){
    $type='application/json; charset=utf-8'
    if($method -in @('GET','HEAD')){
     try{$value=$null;if([IO.File]::Exists($partsViewFile)){$value=Read-PartsView ([IO.File]::ReadAllText($partsViewFile,[Text.Encoding]::UTF8) | ConvertFrom-Json)};$bytes=[Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 5 -Compress));if(-not $value){$bytes=[Text.Encoding]::UTF8.GetBytes('null')}}
     catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot read parts-default-view.json"}')}
    }elseif($method -eq 'POST'){
     $bodyLength=0
     $validLength=[int]::TryParse($headers['Content-Length'],[ref]$bodyLength)
     $allowedOrigin=$true
     if($headers['Origin']){try{$origin=[Uri]$headers['Origin'];$allowedOrigin=$origin.Scheme -eq 'http' -and $origin.Authority -eq $headers['Host']}catch{$allowedOrigin=$false}}
     if(-not $allowedOrigin){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Origin not allowed"}')}
     elseif($headers['Content-Type'] -notmatch '^application/json(?:\s*;|$)'){$status='415 Unsupported Media Type';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"JSON required"}')}
     elseif(-not $validLength -or $bodyLength -le 0 -or $bodyLength -gt 16384 -or $headers['Transfer-Encoding']){$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid request size"}')}
     else{
      try{
       $body=New-Object char[] $bodyLength;$read=0
       while($read -lt $bodyLength){$count=$reader.Read($body,$read,$bodyLength-$read);if($count -le 0){throw 'Incomplete request body'};$read+=$count}
       $text=[Text.Encoding]::UTF8.GetString($wireEncoding.GetBytes((-join $body)))
       $value=Read-PartsView ($text | ConvertFrom-Json)
      }catch{$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid camera view"}')}
      if(-not $bytes){
       $temporary=$partsViewFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
       try{
        [IO.File]::WriteAllText($temporary,($value | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        if([IO.File]::Exists($partsViewFile)){[IO.File]::Replace($temporary,$partsViewFile,[NullString]::Value)}else{[IO.File]::Move($temporary,$partsViewFile)}
        $bytes=[Text.Encoding]::UTF8.GetBytes('{"saved":true,"file":"parts-default-view.json"}')
       }catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot write parts-default-view.json"}')}
       finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
      }
     }
    }else{$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Method not allowed"}')}
   }
   elseif($path -eq '/__form_design_view'){
    $type='application/json; charset=utf-8'
    if($method -in @('GET','HEAD')){
     try{$value=$null;if([IO.File]::Exists($designViewFile)){$value=Read-DesignView ([IO.File]::ReadAllText($designViewFile,[Text.Encoding]::UTF8) | ConvertFrom-Json)};$bytes=[Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 5 -Compress));if(-not $value){$bytes=[Text.Encoding]::UTF8.GetBytes('null')}}
     catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot read design-default-view.json"}')}
    }elseif($method -eq 'POST'){
     $bodyLength=0
     $validLength=[int]::TryParse($headers['Content-Length'],[ref]$bodyLength)
     $allowedOrigin=$true
     if($headers['Origin']){try{$origin=[Uri]$headers['Origin'];$allowedOrigin=$origin.Scheme -eq 'http' -and $origin.Authority -eq $headers['Host']}catch{$allowedOrigin=$false}}
     if(-not $allowedOrigin){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Origin not allowed"}')}
     elseif($headers['Content-Type'] -notmatch '^application/json(?:\s*;|$)'){$status='415 Unsupported Media Type';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"JSON required"}')}
     elseif(-not $validLength -or $bodyLength -le 0 -or $bodyLength -gt 16384 -or $headers['Transfer-Encoding']){$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid request size"}')}
     else{
      try{
       $body=New-Object char[] $bodyLength;$read=0
       while($read -lt $bodyLength){$count=$reader.Read($body,$read,$bodyLength-$read);if($count -le 0){throw 'Incomplete request body'};$read+=$count}
       $text=[Text.Encoding]::UTF8.GetString($wireEncoding.GetBytes((-join $body)))
       $value=Read-DesignView ($text | ConvertFrom-Json)
      }catch{$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid design camera view"}')}
      if(-not $bytes){
       $temporary=$designViewFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
       try{
        [IO.File]::WriteAllText($temporary,($value | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        if([IO.File]::Exists($designViewFile)){[IO.File]::Replace($temporary,$designViewFile,[NullString]::Value)}else{[IO.File]::Move($temporary,$designViewFile)}
        $bytes=[Text.Encoding]::UTF8.GetBytes('{"saved":true,"file":"design-default-view.json"}')
       }catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot write design-default-view.json"}')}
       finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
      }
     }
    }else{$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Method not allowed"}')}
   }
   elseif($path -eq '/__form_scene_config'){
    $type='application/json; charset=utf-8'
    if($method -in @('GET','HEAD')){
     try{$value=$null;if([IO.File]::Exists($sceneConfigFile)){$value=Read-SceneConfig ([IO.File]::ReadAllText($sceneConfigFile,[Text.Encoding]::UTF8) | ConvertFrom-Json)};$bytes=[Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 8 -Compress));if(-not $value){$bytes=[Text.Encoding]::UTF8.GetBytes('null')}}
     catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot read scene config"}')}
    }elseif($method -eq 'POST'){
     $bodyLength=0;$validLength=[int]::TryParse($headers['Content-Length'],[ref]$bodyLength);$allowedOrigin=$true
     if($headers['Origin']){try{$origin=[Uri]$headers['Origin'];$allowedOrigin=$origin.Scheme -eq 'http' -and $origin.Authority -eq $headers['Host']}catch{$allowedOrigin=$false}}
     if(-not $allowedOrigin){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Origin not allowed"}')}
     elseif($headers['Content-Type'] -notmatch '^application/json(?:\s*;|$)'){$status='415 Unsupported Media Type';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"JSON required"}')}
     elseif(-not $validLength -or $bodyLength -le 0 -or $bodyLength -gt 131072 -or $headers['Transfer-Encoding']){$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid request size"}')}
     else{
      try{
       $body=New-Object char[] $bodyLength;$read=0
       while($read -lt $bodyLength){$count=$reader.Read($body,$read,$bodyLength-$read);if($count -le 0){throw 'Incomplete request body'};$read+=$count}
       $text=[Text.Encoding]::UTF8.GetString($wireEncoding.GetBytes((-join $body)));$value=Read-SceneConfig ($text | ConvertFrom-Json)
      }catch{$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid scene config"}')}
      if(-not $bytes){
       try{Save-SceneConfig $value;$bytes=[Text.Encoding]::UTF8.GetBytes(('{{"saved":true,"config":{0}}}' -f (ConvertTo-Json -InputObject $value -Depth 8 -Compress)))}catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot write scene config"}')}
      }
     }
    }else{$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Method not allowed"}')}
   }
   elseif($path -eq '/__form_fabric_colors'){
    $type='application/json; charset=utf-8'
    if($method -in @('GET','HEAD')){
     try{$value=Read-FabricColors ([IO.File]::ReadAllText($fabricColorsFile,[Text.Encoding]::UTF8));$bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $value -Depth 5 -Compress))}
     catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot read fabric colors"}')}
    }elseif($method -eq 'POST'){
     $bodyLength=0;$validLength=[int]::TryParse($headers['Content-Length'],[ref]$bodyLength);$allowedOrigin=$true
     if($headers['Origin']){try{$origin=[Uri]$headers['Origin'];$allowedOrigin=$origin.Scheme -eq 'http' -and $origin.Authority -eq $headers['Host']}catch{$allowedOrigin=$false}}
     if(-not $allowedOrigin){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Origin not allowed"}')}
     elseif($headers['Content-Type'] -notmatch '^application/json(?:\s*;|$)'){$status='415 Unsupported Media Type';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"JSON required"}')}
     elseif(-not $validLength -or $bodyLength -le 0 -or $bodyLength -gt 98304 -or $headers['Transfer-Encoding']){$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid request size"}')}
     else{
      try{
       $body=New-Object char[] $bodyLength;$read=0
       while($read -lt $bodyLength){$count=$reader.Read($body,$read,$bodyLength-$read);if($count -le 0){throw 'Incomplete request body'};$read+=$count}
       $text=[Text.Encoding]::UTF8.GetString($wireEncoding.GetBytes((-join $body)))
       $value=Read-FabricColors $text
      }catch{$status='400 Bad Request';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Invalid fabric colors"}')}
      if(-not $bytes){
       try{
        Save-FabricColors $value
        $bytes=[Text.Encoding]::UTF8.GetBytes('{"saved":true,"file":"fabric-colors.json"}')
       }catch{$status='500 Internal Server Error';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Cannot write fabric colors"}')}
      }
     }
    }else{$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('{"error":"Method not allowed"}')}
   }
   elseif($method -notin @('GET','HEAD')){$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('Method not allowed')}
   elseif($path -eq '/__form_health'){$bytes=[Text.Encoding]::UTF8.GetBytes($root)}
   else{
    if($path -eq '/'){$path='/index.html'}
    $relative=$path.TrimStart('/').Replace('/',[IO.Path]::DirectorySeparatorChar)
    $full=[IO.Path]::GetFullPath((Join-Path $root $relative))
    $extension=[IO.Path]::GetExtension($full).ToLowerInvariant()
    if(-not $full.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $mime.ContainsKey($extension)){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('Forbidden')}
    elseif(-not [IO.File]::Exists($full)){$status='404 Not Found';$bytes=[Text.Encoding]::UTF8.GetBytes('Not found')}
    else{
     $type=$mime[$extension]
     $fileInfo=[IO.FileInfo]::new($full)
     $etag='"'+$fileInfo.Length.ToString('x')+'-'+$fileInfo.LastWriteTimeUtc.Ticks.ToString('x')+'"'
     $cacheControl='public, max-age=0, must-revalidate'
     $cacheHeaders="ETag: $etag`r`nLast-Modified: $($fileInfo.LastWriteTimeUtc.ToString('R'))`r`n"
     if($headers['If-None-Match'] -eq $etag){$status='304 Not Modified';$bytes=[byte[]]@()}else{$fileStream=[IO.File]::OpenRead($full)}
    }
   }
   if($fileStream){$length=$fileStream.Length}else{$length=$bytes.Length}
   $lengthHeader="Content-Length: $length`r`n";if($status -eq '304 Not Modified'){$lengthHeader=''}
   $header="HTTP/1.1 $status`r`nContent-Type: $type`r`n${lengthHeader}Cache-Control: $cacheControl`r`n${cacheHeaders}Connection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
   $h=[Text.Encoding]::ASCII.GetBytes($header);$stream.Write($h,0,$h.Length)
   if($method -ne 'HEAD'){if($fileStream){$fileStream.CopyTo($stream)}else{$stream.Write($bytes,0,$bytes.Length)}}
   $stream.Flush()
  }catch{Write-Verbose $_.Exception.Message}finally{if($fileStream){$fileStream.Dispose()};if($stream){$stream.Dispose()};$client.Close()}
 }
}finally{$listener.Stop()}
