function Invoke-ShowcaseProxy([string]$body, [hashtable]$headers, [string]$root) {
 $node=Get-Command node -ErrorAction SilentlyContinue
 $nodePath=if($node){$node.Source}else{Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'}
 if(-not [IO.File]::Exists($nodePath)){return @{Code=503;Bytes=[Text.Encoding]::UTF8.GetBytes('{"error":{"message":"本地分享服务需要 Node.js，请安装后重新启动编辑器"}}')}}
 $taskProcessInfo=[Diagnostics.ProcessStartInfo]::new()
 $taskProcessInfo.FileName=$nodePath;$taskProcessInfo.Arguments='"'+(Join-Path $root 'utils/showcase-request.mjs')+'"'
 $taskProcessInfo.UseShellExecute=$false;$taskProcessInfo.CreateNoWindow=$true
 $taskProcessInfo.RedirectStandardInput=$true;$taskProcessInfo.RedirectStandardOutput=$true;$taskProcessInfo.RedirectStandardError=$true
 $taskProcessInfo.StandardInputEncoding=[Text.UTF8Encoding]::new($false);$taskProcessInfo.StandardOutputEncoding=[Text.Encoding]::UTF8
 $taskProcess=[Diagnostics.Process]::new();$taskProcess.StartInfo=$taskProcessInfo
 try{
  $null=$taskProcess.Start()
  $payload=@{method='POST';headers=@{'content-type'='application/json';origin=$headers['Origin'];host=$headers['Host']};body=$body}|ConvertTo-Json -Depth 4 -Compress
  $taskProcess.StandardInput.Write($payload);$taskProcess.StandardInput.Close()
  $stdoutTask=$taskProcess.StandardOutput.ReadToEndAsync();$stderrTask=$taskProcess.StandardError.ReadToEndAsync()
  if(-not $taskProcess.WaitForExit(30000)){try{$taskProcess.Kill()}catch{};throw 'Showcase timeout'}
  $reply=$stdoutTask.GetAwaiter().GetResult()|ConvertFrom-Json
  return @{Code=[int]$reply.status;Bytes=[Text.Encoding]::UTF8.GetBytes(($reply.body|ConvertTo-Json -Depth 100 -Compress))}
 }catch{return @{Code=503;Bytes=[Text.Encoding]::UTF8.GetBytes('{"error":{"message":"本地分享服务暂不可用，请检查服务器配置"}}')}}
 finally{$taskProcess.Dispose()}
}
