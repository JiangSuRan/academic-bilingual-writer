# 通过 UI Automation 操作原生保存对话框:填文件名并点击保存
param([string]$Path)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$p = Get-Process | Where-Object { $_.MainWindowTitle -match '保存文稿' } | Select-Object -First 1
if (-not $p) { Write-Host 'DIALOG_NOT_FOUND'; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$edit = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $edit) { Write-Host 'EDIT_NOT_FOUND'; exit 1 }
$vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$vp.SetValue($Path)
Start-Sleep -Milliseconds 400
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '保存(S)')
$btn = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
if ($btn) { ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke(); Write-Host 'SAVE_INVOKED' }
else { Write-Host 'BTN_NOT_FOUND' }
