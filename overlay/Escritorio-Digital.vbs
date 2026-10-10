' Abre o overlay do Escritório Digital sem janela de terminal. Dê dois cliques.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Primeiro rode 'npm install' na pasta overlay.", 48, "Escritório Digital"
Else
  sh.CurrentDirectory = dir
  sh.Run """" & exe & """ .", 0, False
End If
