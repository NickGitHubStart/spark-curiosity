using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Interop;

internal static partial class Program
{
    private static void TriggerDictation(Window window)
    {
        try
        {
            window.Activate();
            var hwnd = new WindowInteropHelper(window).Handle;
            if (hwnd != IntPtr.Zero)
            {
                SetForegroundWindow(hwnd);
                Thread.Sleep(200);
            }
            var inputs = new INPUT[]
            {
                new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = VK_LWIN, dwFlags = 0 } } },
                new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = VK_H, dwFlags = 0 } } },
                new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = VK_H, dwFlags = KEYEVENTF_KEYUP } } },
                new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = VK_LWIN, dwFlags = KEYEVENTF_KEYUP } } }
            };
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
            Thread.Sleep(200);
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        }
        catch { }
    }

    private static int CloseCurrentTab(string? hwndStr)
    {
        IntPtr targetHwnd = IntPtr.Zero;
        if (!string.IsNullOrWhiteSpace(hwndStr) && long.TryParse(hwndStr, out var hwndVal) && hwndVal != 0)
        {
            targetHwnd = new IntPtr(hwndVal);
        }

        if (targetHwnd != IntPtr.Zero)
        {
            var uiaResult = CloseActiveTabViaUia(targetHwnd);
            if (uiaResult == 0) return 0;
        }

        try
        {
            uint currentThreadId = GetCurrentThreadId();
            bool attached = false;
            uint targetThreadId = 0;

            if (targetHwnd != IntPtr.Zero)
            {
                targetThreadId = (uint)GetWindowThreadProcessId(targetHwnd, out _);
                if (targetThreadId != 0 && targetThreadId != currentThreadId)
                {
                    attached = AttachThreadInput(currentThreadId, targetThreadId, true);
                }
                if (IsIconic(targetHwnd)) ShowWindow(targetHwnd, SW_RESTORE);
                SetForegroundWindow(targetHwnd);
                Thread.Sleep(350);
            }

            SendKeyCombo(VK_CONTROL, VK_W);
            Thread.Sleep(350);

            if (attached)
            {
                AttachThreadInput(currentThreadId, targetThreadId, false);
            }
            return 0;
        }
        catch { return 1; }
    }

    private static int CloseActiveTabViaUia(IntPtr hwnd)
    {
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return 2;

            var tabCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem);
            var tabs = root.FindAll(TreeScope.Subtree, tabCond);
            if (tabs.Count == 0) return 2;

            AutomationElement? activeTab = null;
            for (int i = 0; i < tabs.Count; i++)
            {
                try
                {
                    if (tabs[i].TryGetCurrentPattern(SelectionItemPattern.Pattern, out var p) &&
                        p is SelectionItemPattern sel && sel.Current.IsSelected)
                    { activeTab = tabs[i]; break; }
                }
                catch { }
            }
            if (activeTab == null) return 2;

            var btnCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            var buttons = activeTab.FindAll(TreeScope.Descendants, btnCond);

            for (int i = 0; i < buttons.Count; i++)
            {
                var name = (buttons[i].Current.Name ?? "").ToLowerInvariant();
                if (name.Contains("close") || name.Contains("schlie"))
                {
                    if (TryInvoke(buttons[i])) return 0;
                }
            }

            for (int i = 0; i < buttons.Count; i++)
            {
                if (TryInvoke(buttons[i])) return 0;
            }

            var rect = activeTab.Current.BoundingRectangle;
            if (rect.IsEmpty || rect.Width < 20) return 2;

            int x = (int)(rect.Right - 16);
            int y = (int)(rect.Top + rect.Height / 2);
            SetCursorPos(x, y);
            Thread.Sleep(60);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(150);
            return 0;
        }
        catch { return 1; }
    }

    private static bool TryInvoke(AutomationElement el)
    {
        if (el.TryGetCurrentPattern(InvokePattern.Pattern, out var pat) && pat is InvokePattern inv)
        {
            inv.Invoke();
            Thread.Sleep(150);
            return true;
        }
        return false;
    }

    private static int CloseWindow(string? hwndStr)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(hwndStr) && long.TryParse(hwndStr, out var hwndVal) && hwndVal != 0)
            {
                var hwnd = new IntPtr(hwndVal);
                if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
                Thread.Sleep(120);
                PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                Thread.Sleep(120);
                return 0;
            }
            return 2;
        }
        catch { return 1; }
    }

    private static int NavigateCurrentTab(string? hwndStr, string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return 2;
        try
        {
            string? previousClipboard = null;
            try { if (Clipboard.ContainsText()) previousClipboard = Clipboard.GetText(); } catch { }

            Clipboard.SetText(url);

            uint currentThreadId = GetCurrentThreadId();
            bool attached = false;
            uint targetThreadId = 0;

            if (!string.IsNullOrWhiteSpace(hwndStr) && long.TryParse(hwndStr, out var hwndVal) && hwndVal != 0)
            {
                var hwnd = new IntPtr(hwndVal);
                targetThreadId = (uint)GetWindowThreadProcessId(hwnd, out _);
                if (targetThreadId != 0 && targetThreadId != currentThreadId)
                {
                    attached = AttachThreadInput(currentThreadId, targetThreadId, true);
                }
                if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
                Thread.Sleep(350);

                var fg = GetForegroundWindow();
                if (fg != hwnd)
                {
                    SetForegroundWindow(hwnd);
                    Thread.Sleep(250);
                }
            }

            SendKeyCombo(VK_CONTROL, VK_L);
            Thread.Sleep(250);

            SendKeyCombo(VK_CONTROL, VK_A);
            Thread.Sleep(100);

            SendKeyCombo(VK_CONTROL, VK_V);
            Thread.Sleep(150);

            SendSingleKey(VK_RETURN);

            if (attached)
            {
                Thread.Sleep(50);
                AttachThreadInput(currentThreadId, targetThreadId, false);
            }

            Thread.Sleep(200);
            try
            {
                if (previousClipboard != null) Clipboard.SetText(previousClipboard);
                else Clipboard.Clear();
            }
            catch { }

            return 0;
        }
        catch { return 1; }
    }

    private static void SendKeyCombo(ushort modifier, ushort key)
    {
        var inputs = new INPUT[]
        {
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = modifier, dwFlags = 0 } } },
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = 0 } } },
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = KEYEVENTF_KEYUP } } },
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = modifier, dwFlags = KEYEVENTF_KEYUP } } }
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    private static void SendSingleKey(ushort key)
    {
        var inputs = new INPUT[]
        {
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = 0 } } },
            new INPUT { type = INPUT_KEYBOARD, u = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = KEYEVENTF_KEYUP } } }
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }
}
