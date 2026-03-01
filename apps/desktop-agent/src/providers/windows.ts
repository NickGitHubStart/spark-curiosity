import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

export async function getActiveWindowWindows(): Promise<ActiveWindowContext | null> {
  const psScript = [
    "$sig='[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);'",
    "Add-Type -Name Win32 -Namespace Spark -MemberDefinition $sig | Out-Null",
    "$h=[Spark.Win32]::GetForegroundWindow()",
    "$pid=0",
    "[Spark.Win32]::GetWindowThreadProcessId($h,[ref]$pid) | Out-Null",
    "$p=Get-Process -Id $pid -ErrorAction SilentlyContinue",
    "if($p){ Write-Output ($p.ProcessName + '\\t' + $p.MainWindowTitle) }"
  ].join("; ");

  const raw = await runCommand("powershell", ["-NoProfile", "-Command", psScript])
    || await runCommand("powershell.exe", ["-NoProfile", "-Command", psScript]);
  if (!raw) return null;

  const [appNameRaw, titleRaw] = raw.split("\t");
  return {
    appName: (appNameRaw || "unknown-app").trim(),
    title: (titleRaw || "(unknown window)").trim()
  };
}
