using System;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Automation;

internal static partial class Program
{
    private static readonly Regex BrowserName = new Regex("(chrome|msedge|brave|opera|firefox)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AddressBarName = new Regex(
        "(Address and search bar|Search or enter address|Search with Google or enter address|Search or enter web address|Adresse und Suchleiste|Adress- und Suchleiste)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static string _lastEmittedJson = "";
    private static readonly object _emitLock = new object();

    private static void EmitIfChanged()
    {
        var ctx = GetContext();
        if (ctx == null) return;
        var json = JsonSerializer.Serialize(ctx);
        lock (_emitLock)
        {
            if (json == _lastEmittedJson) return;
            _lastEmittedJson = json;
        }
        Console.WriteLine(json);
        Console.Out.Flush();
    }

    private static int WatchForeground()
    {
        IntPtr hookFg = IntPtr.Zero;
        IntPtr hookName = IntPtr.Zero;
        UIntPtr timerId = UIntPtr.Zero;
        WinEventProc? fgProc = null;
        WinEventProc? nameProc = null;
        TimerProc? timerProc = null;
        try
        {
            fgProc = (h, evt, hwnd, idObj, idChild, tid, time) =>
            {
                if (hwnd == IntPtr.Zero) return;
                EmitIfChanged();
            };

            nameProc = (h, evt, hwnd, idObj, idChild, tid, time) =>
            {
                var fg = GetForegroundWindow();
                if (fg == IntPtr.Zero || hwnd != fg) return;
                EmitIfChanged();
            };

            timerProc = (hWnd, uMsg, nIDEvent, dwTime) =>
            {
                EmitIfChanged();
            };

            hookFg = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, fgProc, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (hookFg == IntPtr.Zero) return 3;

            hookName = SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, nameProc, 0, 0, WINEVENT_OUTOFCONTEXT);

            timerId = (UIntPtr)SetTimer(IntPtr.Zero, UIntPtr.Zero, POLL_INTERVAL_MS, timerProc);

            while (GetMessage(out var msg, IntPtr.Zero, 0, 0))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            return 0;
        }
        finally
        {
            if (timerId != UIntPtr.Zero) KillTimer(IntPtr.Zero, timerId);
            if (hookName != IntPtr.Zero) UnhookWinEvent(hookName);
            if (hookFg != IntPtr.Zero) UnhookWinEvent(hookFg);
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
            url = string.IsNullOrWhiteSpace(url) ? null : url.Trim(),
            hwnd = hwnd.ToInt64()
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
                    var normalized = NormalizeUrl(vp.Current.Value);
                    if (normalized != null) return normalized;
                }
            }

            for (int i = 0; i < edits.Count; i++)
            {
                var el = edits[i];
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out var pat) && pat is ValuePattern vp)
                {
                    var normalized = NormalizeUrl(vp.Current.Value);
                    if (normalized != null) return normalized;
                }
            }
        }
        catch { }
        return null;
    }

    private static string? NormalizeUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return trimmed;
        if (trimmed.Contains(".") && !trimmed.Contains(" "))
            return "https://" + trimmed;
        return null;
    }
}
