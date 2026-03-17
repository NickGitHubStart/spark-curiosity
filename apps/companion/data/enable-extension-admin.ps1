$ErrorActionPreference = 'Stop'
reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "lekfgpafpkafblkmeabbicmochphncnm;http://127.0.0.1:4343/extension/update.xml" /f
reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 1 /t REG_SZ /d "http://127.0.0.1:4343/*" /f
reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "lekfgpafpkafblkmeabbicmochphncnm;http://127.0.0.1:4343/extension/update.xml" /f
reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 1 /t REG_SZ /d "http://127.0.0.1:4343/*" /f