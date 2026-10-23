$ErrorActionPreference='Stop'
$workspaceRoot=Split-Path $PSScriptRoot -Parent
. (Join-Path $workspaceRoot 'utils/capture-ai-proxy.ps1')
$script:aiCalls=@();$script:aiSite='http://64.186.244.43:12001';$script:aiStatus=200
function Invoke-CaptureAiHttp($http,[string]$uri,[hashtable]$requestHeaders,[string]$json){
 $script:aiCalls+=@{Uri=$uri;Headers=$requestHeaders;Json=$json}
 $content='{}';$code=200
 if($uri.EndsWith('/auth/v1/user')){if($requestHeaders.Authorization -eq 'Bearer bob-session'){$content='{"id":"bob"}'}else{$content='{"id":"alice"}'}}
 elseif($uri.Contains('spenic_capture_ai_site')){$content=ConvertTo-Json -InputObject @(@{base=$script:aiSite}) -Compress}
 elseif($uri.Contains('spenic_capture_ai_accounts')){if($uri.EndsWith('bob')){$content='[{"api_key":"bob-private-key"}]'}else{$content='[{"api_key":"alice-private-key"}]'}}
 else{$code=$script:aiStatus;if($code -eq 200){$content='{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"fixture"}}]}}]}'}else{$content='{"error":{"message":"alice-private-key must not be echoed"}}'}}
 return @{Code=$code;Bytes=[Text.Encoding]::UTF8.GetBytes($content)}
}
$payload=ConvertTo-Json -InputObject @{model='「Rim」gemini-3.1-flash-image-preview';body=@{contents=@(@{role='user';parts=@(@{text='测试提示词'})});generationConfig=@{responseModalities=@('IMAGE');imageConfig=@{imageSize='4K'}}};url='http://localhost/ignored';apiKey='ignored'} -Depth 20 -Compress
$reply=Invoke-CaptureAiProxy $payload 'Bearer alice-session' $workspaceRoot
if($reply.Code -ne 200){throw ([Text.Encoding]::UTF8.GetString($reply.Bytes))}
$sent=$script:aiCalls[-1]
if($sent.Uri -notmatch ':12001/v1beta/models/%E3%80%8CRim%E3%80%8Dgemini-3.1-flash-image-preview:generateContent' -or $sent.Headers['X-API-Key'] -ne 'alice-private-key'){throw 'Model routing or current-account Key was changed'}
$body=$sent.Json | ConvertFrom-Json
if($body.generationConfig.imageConfig.imageSize -ne '4K' -or $body.contents[0].parts[0].text -cne '测试提示词'){throw 'Generation body was changed'}
$script:aiSite='http://64.186.244.43:12002'
$reply=Invoke-CaptureAiProxy $payload 'Bearer bob-session' $workspaceRoot
if($reply.Code -ne 200 -or $script:aiCalls[-1].Headers.Authorization -ne 'Bearer bob-private-key' -or $script:aiCalls[-1].Uri -notmatch ':12002/'){throw 'Latest endpoint or account isolation failed'}
$script:aiCalls=@()
if((Invoke-CaptureAiProxy $payload '' $workspaceRoot).Code -ne 401 -or $script:aiCalls.Count -ne 0){throw 'Unauthenticated request reached cloud'}
$script:aiSite='http://127.0.0.1'
if((Invoke-CaptureAiProxy $payload 'Bearer alice-session' $workspaceRoot).Code -ne 400 -or $script:aiCalls[-1].Json){throw 'Private endpoint was accepted'}
$script:aiSite='http://64.186.244.43:12001'
foreach($status in @(401,404,429,500)){
 $script:aiStatus=$status;$reply=Invoke-CaptureAiProxy $payload 'Bearer alice-session' $workspaceRoot
 $errorText=[Text.Encoding]::UTF8.GetString($reply.Bytes)
 if($reply.Code -ne $status -or $errorText.Contains('private-key') -or -not $errorText.Contains([string]$status)){throw 'Provider error was not safely explained'}
}
Write-Output ('PASS PowerShell '+$PSVersionTable.PSVersion+': same-origin proxy, complete model, Unicode prompt, latest endpoint, account isolation, private target rejection and sanitized errors')
