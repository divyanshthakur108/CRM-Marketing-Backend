$voice = New-Object -ComObject SAPI.SpVoice
$stream = New-Object -ComObject SAPI.SpFileStream
$wavPath = "D:\realcrm\CRM-Marketing-Backend\storage\mock_ai_gen\test_voice.wav"
$stream.Open($wavPath, 3, $false)
$voice.AudioOutputStream = $stream
$voice.Speak("Welcome to The Grand Residence. Luxury living redefined.")
$stream.Close()
Get-Item $wavPath | Select-Object FullName, Length
