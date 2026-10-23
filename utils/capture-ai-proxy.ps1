# Same-origin AI transport for the Windows PowerShell launcher (no Node install required).
Add-Type -AssemblyName System.Net.Http

function Invoke-CaptureAiHttp($http, [string]$uri, [hashtable]$requestHeaders, [string]$json){
 $verb=[Net.Http.HttpMethod]::Get;if($json){$verb=[Net.Http.HttpMethod]::Post}
 $outgoing=[Net.Http.HttpRequestMessage]::new($verb,$uri);$incoming=$null
 try{
  foreach($name in $requestHeaders.Keys){$null=$outgoing.Headers.TryAddWithoutValidation($name,[string]$requestHeaders[$name])}
  if($json){$outgoing.Content=[Net.Http.StringContent]::new($json,[Text.Encoding]::UTF8,'application/json')}
  $incoming=$http.SendAsync($outgoing).GetAwaiter().GetResult()
  $content=$incoming.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
  return @{Code=[int]$incoming.StatusCode;Bytes=$content}
 }finally{if($incoming){$incoming.Dispose()};$outgoing.Dispose()}
}
function Test-CaptureAiPublicAddress([Net.IPAddress]$address){
 if($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6){return $address.ToString() -match '^[23][0-9a-f]{3}:'}
 $octets=$address.GetAddressBytes();$a=[int]$octets[0];$b=[int]$octets[1]
 return -not ($a -in @(0,10,127) -or $a -ge 224 -or ($a -eq 169 -and $b -eq 254) -or ($a -eq 172 -and $b -ge 16 -and $b -le 31) -or ($a -eq 192 -and $b -eq 168) -or ($a -eq 100 -and $b -ge 64 -and $b -le 127))
}
function Invoke-CaptureAiProxy([string]$json,[string]$authorization,[string]$workspaceRoot){
 $http=$null;$handler=$null
 $result=@{Code=502;Bytes=[byte[]]@()}
 $message='AI 服务连接失败，请检查全站 API 地址或稍后重试'
 try{
  if($authorization -notmatch '^Bearer \S+$'){$result.Code=401;$message='请重新登录后使用 AI 绘图';throw $message}
  try{$inputValue=$json | ConvertFrom-Json}catch{$result.Code=400;$message='绘图请求格式无效';throw $message}
  if($inputValue.model -isnot [string] -or $inputValue.body.contents -isnot [Array] -or $inputValue.body.contents.Count -eq 0){$result.Code=400;$message='绘图请求格式无效';throw $message}
  $model=$inputValue.model.Trim() -replace '^.*/models/','' -replace '^(models/|v1beta/)',''
  if(-not $model -or $model.Length -gt 200 -or $model -match '[/?#\r\n]'){$result.Code=400;$message='AI 模型名称无效';throw $message}
  $publicConfig=[IO.File]::ReadAllText((Join-Path $workspaceRoot 'auth-config.js'))
  $cloudUrl=[regex]::Match($publicConfig,"url:\s*'([^']+)'").Groups[1].Value
  $publishable=[regex]::Match($publicConfig,"publishableKey:\s*'([^']+)'").Groups[1].Value
  if(-not $cloudUrl -or -not $publishable){$result.Code=503;$message='云端登录配置无效';throw $message}
  $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
  $http=[Net.Http.HttpClient]::new($handler);$http.Timeout=[TimeSpan]::FromSeconds(180)
  $cloudHeaders=@{apikey=$publishable;Authorization=$authorization}
  $userReply=Invoke-CaptureAiHttp $http ($cloudUrl+'/auth/v1/user') $cloudHeaders ''
  if($userReply.Code -ne 200){
   $result.Code=503;$message='暂时无法验证登录，请稍后重试'
   if($userReply.Code -in @(401,403)){$result.Code=401;$message='登录已失效，请重新登录'}
   throw $message
  }
  $user=([Text.Encoding]::UTF8.GetString($userReply.Bytes) | ConvertFrom-Json)
  if(-not $user.id){$result.Code=401;$message='登录已失效，请重新登录';throw $message}
  $siteReply=Invoke-CaptureAiHttp $http ($cloudUrl+'/rest/v1/spenic_capture_ai_site?select=base&id=eq.site') $cloudHeaders ''
  $accountReply=Invoke-CaptureAiHttp $http ($cloudUrl+'/rest/v1/spenic_capture_ai_accounts?select=api_key&owner_id=eq.'+[Uri]::EscapeDataString($user.id)) $cloudHeaders ''
  if($siteReply.Code -ne 200 -or $accountReply.Code -ne 200){$result.Code=503;$message='AI 云端配置读取失败，请检查云端配置后重试';throw $message}
  $sites=ConvertFrom-Json -InputObject ('{"rows":'+[Text.Encoding]::UTF8.GetString($siteReply.Bytes)+'}')
  $accounts=ConvertFrom-Json -InputObject ('{"rows":'+[Text.Encoding]::UTF8.GetString($accountReply.Bytes)+'}')
  $key=[string]$accounts.rows[0].api_key
  if(-not $key.Trim()){$result.Code=400;$message='请先填写并保存当前账号的 API Key';throw $message}
  $base=([string]$sites.rows[0].base).Trim().TrimEnd('/')
  $targetText=$base
  if($base.Contains('{{model}}')){$targetText=$base.Replace('{{model}}',[Uri]::EscapeDataString($model))}
  elseif($base -notmatch ':generate'){
   if($base.Contains('/models/')){$targetText=$base+':generateContent'}
   else{$targetText=$base+'/v1beta/models/'+[Uri]::EscapeDataString($model)+':generateContent'}
  }
  try{
   if(-not $base){throw 'Missing target'}
   $target=[Uri]$targetText
   if($target.Scheme -notin @('http','https') -or $target.UserInfo -or $target.Query -or $target.Fragment){throw 'Invalid target'}
   $addresses=[Net.Dns]::GetHostAddresses($target.DnsSafeHost)
   if(-not $addresses.Count){throw 'Missing address'}
   foreach($address in $addresses){if(-not (Test-CaptureAiPublicAddress $address)){throw 'Private target'}}
  }catch{$result.Code=400;$message='全站 API 地址或模型名称无效，请联系管理员检查';throw $message}
  $key=$key.Trim()
  $outboundHeaders=@{Accept='application/json';Authorization=('Bearer '+$key);'X-API-Key'=$key;'X-Banana-Client'='comfyui-banana-li'}
  $generated=Invoke-CaptureAiHttp $http $target.AbsoluteUri $outboundHeaders (ConvertTo-Json -InputObject $inputValue.body -Depth 30 -Compress)
  if($generated.Code -ge 200 -and $generated.Code -lt 300){return $generated}
  $result.Code=$generated.Code
  $message='绘图接口返回错误（HTTP '+$generated.Code+'），请稍后重试或检查模型配置'
  if($generated.Code -in @(401,403)){$message='绘图接口鉴权失败（HTTP '+$generated.Code+'），请检查当前账号的 API Key 和模型权限'}
  elseif($generated.Code -eq 404){$message='绘图接口或模型不存在（HTTP 404），请核对 API 地址和完整模型名称'}
  elseif($generated.Code -eq 429){$message='绘图接口请求过多或额度不足（HTTP 429），请稍后重试或检查额度'}
 }catch{
  if($_.Exception.ToString() -match 'TaskCanceled|Timeout'){$result.Code=504;$message='AI 生成超时，请稍后重试'}
 }finally{if($http){$http.Dispose()};if($handler){$handler.Dispose()}}
 $result.Bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @{error=@{message=$message}} -Compress))
 return $result
}
