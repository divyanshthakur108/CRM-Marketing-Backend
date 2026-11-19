$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
for ($i = 0; $i -lt $voices.Count; $i++) {
    $v = $voices.Item($i)
    Write-Host "$i : $($v.GetDescription())"
}
