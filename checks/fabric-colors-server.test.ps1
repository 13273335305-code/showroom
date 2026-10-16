$ErrorActionPreference='Stop'
$workspaceRoot=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $workspaceRoot 'server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'server.ps1 has syntax errors'}
$validator=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-FabricColors'},$true)
Invoke-Expression $validator.Extent.Text
$fixture=@('WBK','WLG','WBR','WWW','ZGW','DBW','GWW','KGW') | ForEach-Object {@{code=$_;base='#f6f6f6';line='#080808'}}
$defaults=ConvertTo-Json -InputObject @($fixture) -Depth 5
$colors=Read-FabricColors $defaults
if($colors.Count -lt 8 -or $colors[0].code -ne 'WBK'){throw 'Multi-color array was not decoded correctly'}
$new=@($colors)+@(@{code='SDF';base='#f6f6f6';line='#080808'})
$roundtrip=Read-FabricColors (ConvertTo-Json -InputObject $new -Depth 5)
if($roundtrip.Count -ne ($colors.Count+1) -or $roundtrip[-1].code -ne 'SDF'){throw 'New color was not preserved'}
$single=Read-FabricColors '[{"code":"ABC","base":"#AABBCC","line":"#112233"}]'
if($single -isnot [Array] -or $single.Count -ne 1 -or $single[0].base -ne '#aabbcc'){throw 'Single-color array was not decoded correctly'}
$empty=Read-FabricColors '[]'
if($empty -isnot [Array] -or $empty.Count -ne 0){throw 'Empty color array was not decoded correctly'}
foreach($invalid in @('{}','null','[null]','[[]]','[{"code":"AB","base":"#112233","line":"#112233"}]','[{"code":"ABC","base":"#fff","line":"#112233"}]','[{"code":"ABC","base":"#112233","line":"#112233"},{"code":"ABC","base":"#112233","line":"#112233"}]')){
 $rejected=$false
 try{Read-FabricColors $invalid > $null}catch{$rejected=$true}
 if(-not $rejected){throw ('Accepted invalid colors: '+$invalid)}
}
$writer=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Save-FabricColors'},$true)
Invoke-Expression $writer.Extent.Text
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('spenic-color-save-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot > $null
$fabricColorsFile=Join-Path $fixtureRoot 'colors.json'
try{
 Save-FabricColors $colors
 Save-FabricColors $roundtrip
 $persisted=Read-FabricColors ([IO.File]::ReadAllText($fabricColorsFile))
 if($persisted.Count -ne 9 -or $persisted[-1].code -ne 'SDF'){throw 'New color was not saved to disk'}
 $before=[IO.File]::ReadAllText($fabricColorsFile)
 $lock=[IO.File]::Open($fabricColorsFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 $rejected=$false
 try{try{Save-FabricColors $single}catch{$rejected=$true}}finally{$lock.Dispose()}
 if(-not $rejected -or [IO.File]::ReadAllText($fabricColorsFile) -cne $before){throw 'A failed save changed existing colors'}
 Save-FabricColors $single
 $persisted=Read-FabricColors ([IO.File]::ReadAllText($fabricColorsFile))
 if($persisted -isnot [Array] -or $persisted.Count -ne 1 -or $persisted[0].code -ne 'ABC'){throw 'Retry or single-color persistence failed'}
 Save-FabricColors $empty
 $persisted=Read-FabricColors ([IO.File]::ReadAllText($fabricColorsFile))
 if($persisted -isnot [Array] -or $persisted.Count -ne 0){throw 'Deleting the last color did not persist an empty array'}
 Save-FabricColors $single
 $persisted=Read-FabricColors ([IO.File]::ReadAllText($fabricColorsFile))
 if($persisted.Count -ne 1 -or $persisted[0].code -ne 'ABC'){throw 'Adding a color after deleting all colors failed'}
 if((Get-ChildItem -LiteralPath $fixtureRoot -Filter '*.tmp').Count){throw 'Save left temporary files behind'}
}finally{
 if([IO.File]::Exists($fabricColorsFile)){[IO.File]::Delete($fabricColorsFile)}
 [IO.Directory]::Delete($fixtureRoot)
}
Write-Output ('PASS PowerShell '+$PSVersionTable.PSVersion.ToString()+': parsing, saving SDF to disk, reloading, single/empty arrays, deleting all colors, adding again, failed-save preservation and retry')
