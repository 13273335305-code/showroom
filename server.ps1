param([int]$Port=4186,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
$listener=$null
for($candidate=$Port;$candidate -lt $Port+20;$candidate++){
 try {
  $probe=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$candidate/__form_health" -TimeoutSec 1
  if($probe.Content -eq $root){if(-not $NoBrowser){Start-Process "http://127.0.0.1:$candidate/"};exit 0}
 }catch{}
 try{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$candidate);$listener.Start();$Port=$candidate;break}catch{$listener=$null}
}
if(-not $listener){throw 'No available local port. Please close another server and try again.'}
$url="http://127.0.0.1:$Port/"
$Host.UI.RawUI.WindowTitle='FORM Material Studio - close this window to stop'
Write-Host "FORM Material Studio is running at $url"
Write-Host 'Keep this window open. Close it to stop the local server.'
if(-not $NoBrowser){Start-Process $url}
$mime=@{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.json'='application/json';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.webp'='image/webp';'.svg'='image/svg+xml';'.fbx'='application/octet-stream';'.ico'='image/x-icon'}
try{
 while($true){
  $client=$listener.AcceptTcpClient();$client.ReceiveTimeout=5000;$client.SendTimeout=30000
  $stream=$null;$fileStream=$null
  try{
   $stream=$client.GetStream();$reader=[IO.StreamReader]::new($stream,[Text.Encoding]::ASCII,$false,1024,$true)
   $request=$reader.ReadLine();if(-not $request){continue};$parts=$request.Split(' ')
   do{$line=$reader.ReadLine()}while($line)
   $method=$parts[0];$path=[Uri]::UnescapeDataString(($parts[1] -split '\?')[0]);$status='200 OK';$type='text/plain; charset=utf-8';$bytes=$null
   if($method -notin @('GET','HEAD')){$status='405 Method Not Allowed';$bytes=[Text.Encoding]::UTF8.GetBytes('Method not allowed')}
   elseif($path -eq '/__form_health'){$bytes=[Text.Encoding]::UTF8.GetBytes($root)}
   else{
    if($path -eq '/'){$path='/index.html'}
    $relative=$path.TrimStart('/').Replace('/',[IO.Path]::DirectorySeparatorChar)
    $full=[IO.Path]::GetFullPath((Join-Path $root $relative))
    $extension=[IO.Path]::GetExtension($full).ToLowerInvariant()
    if(-not $full.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $mime.ContainsKey($extension)){$status='403 Forbidden';$bytes=[Text.Encoding]::UTF8.GetBytes('Forbidden')}
    elseif(-not [IO.File]::Exists($full)){$status='404 Not Found';$bytes=[Text.Encoding]::UTF8.GetBytes('Not found')}
    else{$type=$mime[$extension];$fileStream=[IO.File]::OpenRead($full)}
   }
   if($fileStream){$length=$fileStream.Length}else{$length=$bytes.Length}
   $header="HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-cache`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
   $h=[Text.Encoding]::ASCII.GetBytes($header);$stream.Write($h,0,$h.Length)
   if($method -ne 'HEAD'){if($fileStream){$fileStream.CopyTo($stream)}else{$stream.Write($bytes,0,$bytes.Length)}}
   $stream.Flush()
  }catch{Write-Verbose $_.Exception.Message}finally{if($fileStream){$fileStream.Dispose()};if($stream){$stream.Dispose()};$client.Close()}
 }
}finally{$listener.Stop()}
