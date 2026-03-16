import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

export async function getActiveWindowWindows(): Promise<ActiveWindowContext | null> {
  const psScript = [
    "$sig='[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);'",
    "Add-Type -Name Win32 -Namespace Spark -MemberDefinition $sig | Out-Null",
    "Add-Type -AssemblyName UIAutomationClient | Out-Null",
    "Add-Type -AssemblyName UIAutomationTypes | Out-Null",
    "$h=[Spark.Win32]::GetForegroundWindow()",
    "$pid=0",
    "[Spark.Win32]::GetWindowThreadProcessId($h,[ref]$pid) | Out-Null",
    "$p=Get-Process -Id $pid -ErrorAction SilentlyContinue",
    "$app=''; $title=''; $url=''",
    "if($p){ $app=$p.ProcessName; $title=$p.MainWindowTitle }",
    "$isBrowser=$app -match 'chrome|msedge|brave|opera|firefox'",
    "if($isBrowser -and $h -ne [IntPtr]::Zero){",
    "  try {",
    "    $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)",
    "    $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)",
    "    $edits=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$cond)",
    "    foreach($e in $edits){",
    "      $name=$e.Current.Name",
    "      if($name -match 'Address and search bar|Search or enter address|Search with Google or enter address|Search or enter web address|Adresse und Suchleiste|Adress- und Suchleiste'){",
    "        $vp=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)",
    "        if($vp -and $vp.Current.Value){ $url=$vp.Current.Value; break }",
    "      }",
    "    }",
    "  } catch {}",
    "}",
    "if($app){ Write-Output ($app + '\\t' + $title + '\\t' + $url) }"
  ].join("; ");

  const raw = await runCommand("powershell", ["-NoProfile", "-Command", psScript])
    || await runCommand("powershell.exe", ["-NoProfile", "-Command", psScript]);
  if (!raw) return null;

  const [appNameRaw, titleRaw, urlRaw] = raw.split("\t");
  return {
    appName: (appNameRaw || "unknown-app").trim(),
    title: (titleRaw || "(unknown window)").trim(),
    url: (urlRaw || "").trim() || undefined
  };
}

export async function closeCurrentTabWindows(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const psScript = [
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "[System.Windows.Forms.SendKeys]::SendWait('^w')",
    "Write-Output 'ok'"
  ].join("; ");
  const raw = await runCommand("powershell", ["-NoProfile", "-Command", psScript])
    || await runCommand("powershell.exe", ["-NoProfile", "-Command", psScript]);
  return Boolean(raw && raw.includes("ok"));
}
