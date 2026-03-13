using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Automation;

internal static class Program
{
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
        WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    private static readonly Regex BrowserName = new Regex("(chrome|msedge|brave|opera|firefox)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AddressBarName = new Regex(
        "(Address and search bar|Search or enter address|Search with Google or enter address|Search or enter web address|Adresse und Suchleiste|Adress- und Suchleiste)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static int Main()
    {
        try
        {
            if (Environment.GetCommandLineArgs().Length > 1 &&
                Environment.GetCommandLineArgs()[1].Equals("--watch", StringComparison.OrdinalIgnoreCase))
            {
                return WatchForeground();
            }

            var ctx = GetContext();
            if (ctx == null) return 2;
            var json = JsonSerializer.Serialize(ctx);
            Console.WriteLine(json);
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    private delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint idEventThread, uint dwmsEventTime);

    private static int WatchForeground()
    {
        IntPtr hook = IntPtr.Zero;
        WinEventProc? proc = null;
        try
        {
            proc = (h, evt, hwnd, idObj, idChild, tid, time) =>
            {
                if (hwnd == IntPtr.Zero) return;
                var ctx = GetContext();
                if (ctx == null) return;
                var json = JsonSerializer.Serialize(ctx);
                Console.WriteLine(json);
                Console.Out.Flush();
            };

            hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, proc, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (hook == IntPtr.Zero) return 3;

            // Keep process alive.
            System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
            return 0;
        }
        finally
        {
            if (hook != IntPtr.Zero) UnhookWinEvent(hook);
        }
    }

    private static object? GetContext()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;

        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid <= 0) return null;

        var proc = Process.GetProcessById(pid);
        var appName = proc.ProcessName;
        var title = proc.MainWindowTitle ?? "(unknown window)";

        string? url = null;
        if (BrowserName.IsMatch(appName))
        {
            url = TryReadAddressBar(hwnd);
        }

        return new
        {
            appName = appName.Trim(),
            title = title.Trim(),
            url = string.IsNullOrWhiteSpace(url) ? null : url.Trim()
        };
    }

    private static string? TryReadAddressBar(IntPtr hwnd)
    {
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return null;

            var cond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
            var edits = root.FindAll(TreeScope.Subtree, cond);
            for (int i = 0; i < edits.Count; i++)
            {
                var el = edits[i];
                var name = el.Current.Name ?? "";
                if (!AddressBarName.IsMatch(name)) continue;

                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out var pat) && pat is ValuePattern vp)
                {
                    var val = vp.Current.Value;
                    if (IsLikelyUrl(val)) return val;
                }
            }
        }
        catch
        {
            // ignore
        }
        return null;
    }

    private static bool IsLikelyUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return true;
        if (value.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return true;
        return value.Contains(".");
    }
}
