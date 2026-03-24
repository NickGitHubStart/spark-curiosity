using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Automation;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

using System.Windows.Threading;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using NAudio.CoreAudioApi;
using NAudio.Wave;

internal static class Program
{
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint EVENT_OBJECT_NAMECHANGE = 0x800C;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const int POLL_INTERVAL_MS = 750;

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
        WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern uint SetTimer(IntPtr hWnd, UIntPtr nIDEvent, uint uElapse, TimerProc lpTimerFunc);

    [DllImport("user32.dll")]
    private static extern bool KillTimer(IntPtr hWnd, UIntPtr uIDEvent);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const int SW_SHOW = 5;

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    private const int INPUT_KEYBOARD = 1;
    private const uint WM_CLOSE = 0x0010;
    private const ushort KEYEVENTF_KEYUP = 0x0002;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_W = 0x57;
    private const ushort VK_L = 0x4C;
    private const ushort VK_V = 0x56;
    private const ushort VK_A = 0x41;
    private const ushort VK_RETURN = 0x0D;
    private const ushort VK_LWIN = 0x5B;
    private const ushort VK_H = 0x48;
    private const int SW_HIDE = 0;
    private const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public int type;
        public INPUTUNION u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    private delegate void TimerProc(IntPtr hWnd, uint uMsg, UIntPtr nIDEvent, uint dwTime);

    private static readonly Regex BrowserName = new Regex("(chrome|msedge|brave|opera|firefox)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AddressBarName = new Regex(
        "(Address and search bar|Search or enter address|Search with Google or enter address|Search or enter web address|Adresse und Suchleiste|Adress- und Suchleiste)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static string _lastEmittedJson = "";
    private static readonly object _emitLock = new object();

    [STAThread]
    private static int Main()
    {
        try
        {
            var args = Environment.GetCommandLineArgs();
            Console.Error.WriteLine($"[spark:native] args({args.Length}): [{string.Join(", ", args)}]");
            // Match by scanning all args (not just args[1]) for robustness
            string FindArg(string name) => Array.Find(args, a => a.Equals(name, StringComparison.OrdinalIgnoreCase));
            int ArgIndex(string name) => Array.FindIndex(args, a => a.Equals(name, StringComparison.OrdinalIgnoreCase));
            if (FindArg("--watch") != null)
                    return WatchForeground();
            if (FindArg("--close-tab") != null)
                    return CloseCurrentTab(args.Length > ArgIndex("--close-tab") + 1 ? args[ArgIndex("--close-tab") + 1] : null);
            if (FindArg("--close-window") != null)
                    return CloseWindow(args.Length > ArgIndex("--close-window") + 1 ? args[ArgIndex("--close-window") + 1] : null);
            if (FindArg("--navigate-tab") != null)
                {
                    var ni = ArgIndex("--navigate-tab");
                    var hwndArg = args.Length > ni + 1 ? args[ni + 1] : null;
                    var urlArg = args.Length > ni + 2 ? args[ni + 2] : null;
                    return NavigateCurrentTab(hwndArg, urlArg);
                }
            if (FindArg("--overlay") != null)
                    return RunOverlay();
            if (FindArg("--quote") != null)
                {
                    var qi = ArgIndex("--quote");
                    var text = args.Length > qi + 1 ? args[qi + 1] : "";
                    var author = ExtractArg(args, "--author");
                    return RunQuoteToast(text, author);
                }
            // --prompt removed (no longer used)

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

    private static string ExtractArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }
        return "";
    }

    private static void HideConsoleWindow()
    {
        var hwnd = GetConsoleWindow();
        if (hwnd != IntPtr.Zero) ShowWindow(hwnd, SW_HIDE);
    }

    private static string CompanionBaseUrl()
    {
        var env = Environment.GetEnvironmentVariable("SPARK_COMPANION_URL");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim().TrimEnd('/');
        return "http://127.0.0.1:4343";
    }

    private static BitmapImage? LoadIcon()
    {
        try
        {
            var rootDir = Environment.GetEnvironmentVariable("SPARK_ROOT_DIR") ?? "";
            var exeDir = AppDomain.CurrentDomain.BaseDirectory ?? "";
            var candidates = new[]
            {
                Path.Combine(rootDir, "apps", "companion", "data", "assets", "icon_round.png"),
                Path.Combine(exeDir, "..", "apps", "companion", "data", "assets", "icon_round.png"),
                Path.Combine(exeDir, "apps", "companion", "data", "assets", "icon_round.png"),
            };
            string path = "";
            foreach (var c in candidates)
            {
                try { if (!string.IsNullOrEmpty(c) && File.Exists(c)) { path = Path.GetFullPath(c); break; } } catch { }
            }
            if (string.IsNullOrEmpty(path)) return null;
            var img = new BitmapImage();
            img.BeginInit();
            img.UriSource = new Uri(path);
            img.CacheOption = BitmapCacheOption.OnLoad;
            img.EndInit();
            img.Freeze();
            return img;
        }
        catch { return null; }
    }

    private static int RunOverlay()
    {
        // Single-instance guard: only one overlay may run at a time.
        // If another instance is already running, exit silently.
        using var mutex = new Mutex(true, "SparkCuriosity_Overlay_SingleInstance", out var createdNew);
        if (!createdNew)
        {
            Console.Error.WriteLine("[spark:overlay] Another overlay instance is already running. Exiting.");
            return 0;
        }
        try
        {
            HideConsoleWindow();
            var app = new Application();
            var window = BuildOverlayWindow();
            app.Run(window);
            return 0;
        }
        catch { return 1; }
    }

    private static Window BuildOverlayWindow()
    {
        const int IconSize = 64;

        // -- Dark theme colors (Companion HTML UIs) --
        var bgColor = Color.FromRgb(11, 15, 26);       // --bg: #0b0f1a
        var panelColor = Color.FromRgb(17, 24, 39);     // --panel: #111827
        var panel2Color = Color.FromRgb(15, 23, 42);    // --panel-2: #0f172a
        var borderColor = Color.FromRgb(31, 41, 55);    // --border: #1f2937
        var textColor = Color.FromRgb(229, 231, 235);   // --text: #e5e7eb
        var mutedColor = Color.FromRgb(156, 163, 175);  // --muted: #9ca3af
        var accentColor = Color.FromRgb(52, 211, 153);  // --accent: #34d399
        var accent2Color = Color.FromRgb(96, 165, 250); // --accent-2: #60a5fa
        var dangerColor = Color.FromRgb(248, 113, 113); // --danger: #f87171
        var inputBgColor = Color.FromRgb(11, 18, 32);   // #0b1220

        var window = new Window
        {
            Width = IconSize,
            Height = IconSize,
            Topmost = true,
            WindowStyle = WindowStyle.None,
            ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false,
            AllowsTransparency = true,
            Background = Brushes.Transparent
        };

        var root = new Grid();
        var dropShadow = new System.Windows.Media.Effects.DropShadowEffect
        {
            Color = Colors.Black,
            BlurRadius = 30,
            ShadowDepth = 10,
            Opacity = 0.45,
            Direction = 270
        };
        var card = new Border
        {
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(999) // starts circular (collapsed FAB)
        };
        root.Children.Add(card);
        window.Content = root;

        var container = new Grid();
        card.Child = container;

        var collapsed = new Grid { Visibility = Visibility.Visible };
        var expanded = new Grid { Visibility = Visibility.Collapsed };
        container.Children.Add(collapsed);
        container.Children.Add(expanded);

        // -- FAB: circular icon button --
        // The PNG has pre-baked circular transparency — just display it directly.
        var icon = LoadIcon();
        FrameworkElement fabContent;
        if (icon != null)
        {
            fabContent = new Image
            {
                Source = icon,
                Width = IconSize,
                Height = IconSize,
                Stretch = Stretch.UniformToFill
            };
        }
        else
        {
            fabContent = new Border
            {
                Width = IconSize,
                Height = IconSize,
                CornerRadius = new CornerRadius(IconSize / 2.0),
                Background = new SolidColorBrush(accentColor),
                Child = new TextBlock
                {
                    Text = "S",
                    Foreground = new SolidColorBrush(Color.FromRgb(6, 32, 22)),
                    FontSize = 28,
                    FontWeight = FontWeights.Bold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
        }

        // Round button template
        var fabTemplate = new ControlTemplate(typeof(Button));
        var fabBorderFactory = new FrameworkElementFactory(typeof(Border));
        fabBorderFactory.SetValue(Border.BackgroundProperty, Brushes.Transparent);
        fabBorderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(999));
        var fabContentPresenter = new FrameworkElementFactory(typeof(ContentPresenter));
        fabContentPresenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        fabContentPresenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        fabBorderFactory.AppendChild(fabContentPresenter);
        fabTemplate.VisualTree = fabBorderFactory;

        var iconButton = new Button
        {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Content = fabContent,
            Template = fabTemplate
        };
        collapsed.Children.Add(iconButton);

        // -- Expanded panel layout --
        expanded.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        expanded.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        expanded.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        expanded.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // -- Header --
        var headerBorder = new Border
        {
            BorderBrush = new SolidColorBrush(borderColor),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(14, 12, 14, 10)
        };
        var header = new DockPanel();
        headerBorder.Child = header;
        FrameworkElement headerIcon;
        if (icon != null)
        {
            headerIcon = new Image { Width = 28, Height = 28, Source = icon, Stretch = Stretch.UniformToFill };
        }
        else
        {
            headerIcon = new Border
            {
                Width = 28, Height = 28,
                CornerRadius = new CornerRadius(14),
                Background = new SolidColorBrush(accentColor),
                Child = new TextBlock
                {
                    Text = "S",
                    Foreground = new SolidColorBrush(Color.FromRgb(6, 32, 22)),
                    FontSize = 14, FontWeight = FontWeights.Bold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
        }
        DockPanel.SetDock(headerIcon, Dock.Left);
        header.Children.Add(headerIcon);
        var title = new TextBlock
        {
            Text = "Spark Curiosity",
            Foreground = new SolidColorBrush(textColor),
            FontWeight = FontWeights.Bold,
            FontSize = 14,
            Margin = new Thickness(10, 4, 0, 0)
        };
        header.Children.Add(title);

        // Transparent button template (shared for header buttons)
        var headerBtnTemplate = new ControlTemplate(typeof(Button));
        var headerBtnBorderFactory = new FrameworkElementFactory(typeof(Border));
        headerBtnBorderFactory.SetValue(Border.BackgroundProperty, Brushes.Transparent);
        var headerBtnContent = new FrameworkElementFactory(typeof(ContentPresenter));
        headerBtnContent.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        headerBtnContent.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        headerBtnBorderFactory.AppendChild(headerBtnContent);
        headerBtnTemplate.VisualTree = headerBtnBorderFactory;

        // Bug/Feedback report button (header, right side)
        var bugBtn = new Button
        {
            Content = "\U0001F41B",
            Foreground = new SolidColorBrush(mutedColor),
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            FontSize = 18,
            Width = 30,
            Height = 30,
            ToolTip = "Bug/Feedback melden",
            HorizontalAlignment = HorizontalAlignment.Right,
            Template = headerBtnTemplate
        };
        DockPanel.SetDock(bugBtn, Dock.Right);
        header.Children.Add(bugBtn);

        // Stats button (header, right of bug button)
        var statsBtn = new Button
        {
            Content = "\U0001F4CA",
            Foreground = new SolidColorBrush(mutedColor),
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            FontSize = 14,
            Width = 24,
            Height = 24,
            ToolTip = "Statistiken",
            HorizontalAlignment = HorizontalAlignment.Right,
            Template = headerBtnTemplate
        };
        DockPanel.SetDock(statsBtn, Dock.Right);
        header.Children.Add(statsBtn);

        expanded.Children.Add(headerBorder);
        Grid.SetRow(headerBorder, 0);

        // -- Messages area --
        var scroll = new ScrollViewer
        {
            Margin = new Thickness(12, 8, 12, 8),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        var messages = new StackPanel();
        scroll.Content = messages;
        expanded.Children.Add(scroll);
        Grid.SetRow(scroll, 1);

        // -- Stats view (replaces messages area when toggled) --
        var statsScroll = new ScrollViewer
        {
            Margin = new Thickness(12, 8, 12, 8),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Visibility = Visibility.Collapsed
        };
        var statsPanel = new StackPanel();
        statsScroll.Content = statsPanel;
        expanded.Children.Add(statsScroll);
        Grid.SetRow(statsScroll, 1);

        // Stats: Hero metric
        var statsHeroNumber = new TextBlock
        {
            Text = "0",
            Foreground = new SolidColorBrush(accentColor),
            FontSize = 42,
            FontWeight = FontWeights.Bold,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 16, 0, 0)
        };
        statsPanel.Children.Add(statsHeroNumber);

        var statsHeroLabel = new TextBlock
        {
            Text = "Minuten besser genutzt",
            Foreground = new SolidColorBrush(textColor),
            FontSize = 14,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 2, 0, 4)
        };
        statsPanel.Children.Add(statsHeroLabel);

        var statsHeroBlocks = new TextBlock
        {
            Text = "0 Ablenkungen blockiert",
            Foreground = new SolidColorBrush(mutedColor),
            FontSize = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16)
        };
        statsPanel.Children.Add(statsHeroBlocks);

        // Stats: Range toggle (Heute / Woche / Gesamt)
        var statsRangePanel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16)
        };
        var currentRange = "total";
        var rangeBtnTemplate = new ControlTemplate(typeof(Button));
        var rangeBorderFact = new FrameworkElementFactory(typeof(Border));
        rangeBorderFact.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
        rangeBorderFact.SetValue(Border.PaddingProperty, new Thickness(12, 6, 12, 6));
        rangeBorderFact.SetValue(Border.BackgroundProperty, Brushes.Transparent);
        var rangeContentFact = new FrameworkElementFactory(typeof(ContentPresenter));
        rangeContentFact.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        rangeBorderFact.AppendChild(rangeContentFact);
        rangeBtnTemplate.VisualTree = rangeBorderFact;

        var rangeBtnToday = new Button { Content = "Heute", FontSize = 12, Foreground = new SolidColorBrush(mutedColor), Background = Brushes.Transparent, BorderThickness = new Thickness(0), Margin = new Thickness(2, 0, 2, 0), Template = rangeBtnTemplate };
        var rangeBtnWeek = new Button { Content = "Woche", FontSize = 12, Foreground = new SolidColorBrush(mutedColor), Background = Brushes.Transparent, BorderThickness = new Thickness(0), Margin = new Thickness(2, 0, 2, 0), Template = rangeBtnTemplate };
        var rangeBtnTotal = new Button { Content = "Gesamt", FontSize = 12, Foreground = new SolidColorBrush(accentColor), Background = Brushes.Transparent, BorderThickness = new Thickness(0), Margin = new Thickness(2, 0, 2, 0), Template = rangeBtnTemplate };
        statsRangePanel.Children.Add(rangeBtnToday);
        statsRangePanel.Children.Add(rangeBtnWeek);
        statsRangePanel.Children.Add(rangeBtnTotal);
        statsPanel.Children.Add(statsRangePanel);

        // Stats: Separator
        var statsSep = new Border
        {
            Height = 1,
            Background = new SolidColorBrush(borderColor),
            Margin = new Thickness(0, 0, 0, 12)
        };
        statsPanel.Children.Add(statsSep);

        // Stats: Platform breakdown header
        var statsBreakdownHeader = new Grid { Margin = new Thickness(4, 0, 4, 6) };
        statsBreakdownHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statsBreakdownHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        statsBreakdownHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(70) });
        statsBreakdownHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });
        var hdrPlatform = new TextBlock { Text = "Plattform", Foreground = new SolidColorBrush(mutedColor), FontSize = 11 };
        var hdrBlocks = new TextBlock { Text = "Blocks", Foreground = new SolidColorBrush(mutedColor), FontSize = 11, HorizontalAlignment = HorizontalAlignment.Right };
        var hdrDuration = new TextBlock { Text = "\u00D8 Session", Foreground = new SolidColorBrush(mutedColor), FontSize = 11, HorizontalAlignment = HorizontalAlignment.Right };
        var hdrMinutes = new TextBlock { Text = "Minuten", Foreground = new SolidColorBrush(mutedColor), FontSize = 11, HorizontalAlignment = HorizontalAlignment.Right };
        Grid.SetColumn(hdrPlatform, 0); Grid.SetColumn(hdrBlocks, 1); Grid.SetColumn(hdrDuration, 2); Grid.SetColumn(hdrMinutes, 3);
        statsBreakdownHeader.Children.Add(hdrPlatform);
        statsBreakdownHeader.Children.Add(hdrBlocks);
        statsBreakdownHeader.Children.Add(hdrDuration);
        statsBreakdownHeader.Children.Add(hdrMinutes);
        statsPanel.Children.Add(statsBreakdownHeader);

        // Stats: Platform rows container
        var statsPlatformList = new StackPanel();
        statsPanel.Children.Add(statsPlatformList);

        // Stats: Hint text
        var statsHint = new TextBlock
        {
            Text = "Klicke auf \u00D8 Session um die Dauer anzupassen.",
            Foreground = new SolidColorBrush(mutedColor),
            FontSize = 10,
            FontStyle = FontStyles.Italic,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 16, 0, 8),
            TextWrapping = TextWrapping.Wrap
        };
        statsPanel.Children.Add(statsHint);

        // Stats view state
        bool statsMode = false;

        void SetRangeButtonStyles(string range)
        {
            rangeBtnToday.Foreground = range == "today" ? new SolidColorBrush(accentColor) : new SolidColorBrush(mutedColor);
            rangeBtnWeek.Foreground = range == "week" ? new SolidColorBrush(accentColor) : new SolidColorBrush(mutedColor);
            rangeBtnTotal.Foreground = range == "total" ? new SolidColorBrush(accentColor) : new SolidColorBrush(mutedColor);
        }

        async void LoadStats(string range)
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                var statsRes = await http.GetAsync($"{CompanionBaseUrl()}/stats?range={range}");
                if (!statsRes.IsSuccessStatusCode) return;
                var statsJson = await statsRes.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(statsJson);
                var root = doc.RootElement;

                var totalMinutes = root.TryGetProperty("totalMinutes", out var tmEl) ? tmEl.GetInt32() : 0;
                var totalBlocks = root.TryGetProperty("totalBlocks", out var tbEl) ? tbEl.GetInt32() : 0;

                statsHeroNumber.Dispatcher.Invoke(() =>
                {
                    statsHeroNumber.Text = totalMinutes.ToString();
                    statsHeroBlocks.Text = $"{totalBlocks} Ablenkung{(totalBlocks != 1 ? "en" : "")} blockiert";
                    statsPlatformList.Children.Clear();

                    if (root.TryGetProperty("platforms", out var platformsEl) && platformsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in platformsEl.EnumerateArray())
                        {
                            var platform = p.TryGetProperty("platform", out var plEl) ? plEl.GetString() ?? "" : "";
                            var count = p.TryGetProperty("count", out var cEl) ? cEl.GetInt32() : 0;
                            var sessionDur = p.TryGetProperty("sessionDurationMin", out var sdEl) ? sdEl.GetInt32() : 10;
                            var mins = p.TryGetProperty("minutesSaved", out var msEl) ? msEl.GetInt32() : 0;

                            var row = new Grid { Margin = new Thickness(4, 3, 4, 3) };
                            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(70) });
                            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });

                            var platformLabel = new TextBlock
                            {
                                Text = platform,
                                Foreground = new SolidColorBrush(textColor),
                                FontSize = 13,
                                VerticalAlignment = VerticalAlignment.Center
                            };
                            var countLabel = new TextBlock
                            {
                                Text = count.ToString(),
                                Foreground = new SolidColorBrush(accent2Color),
                                FontSize = 13,
                                FontWeight = FontWeights.SemiBold,
                                HorizontalAlignment = HorizontalAlignment.Right,
                                VerticalAlignment = VerticalAlignment.Center
                            };

                            // Editable session duration button
                            var durBtnTempl = new ControlTemplate(typeof(Button));
                            var durBdrFact = new FrameworkElementFactory(typeof(Border));
                            durBdrFact.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromArgb(25, 96, 165, 250)));
                            durBdrFact.SetValue(Border.CornerRadiusProperty, new CornerRadius(4));
                            durBdrFact.SetValue(Border.PaddingProperty, new Thickness(4, 2, 4, 2));
                            var durCont = new FrameworkElementFactory(typeof(ContentPresenter));
                            durCont.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
                            durBdrFact.AppendChild(durCont);
                            durBtnTempl.VisualTree = durBdrFact;

                            var durBtn = new Button
                            {
                                Content = $"{sessionDur} min",
                                Foreground = new SolidColorBrush(accent2Color),
                                FontSize = 11,
                                Background = Brushes.Transparent,
                                BorderThickness = new Thickness(0),
                                HorizontalAlignment = HorizontalAlignment.Right,
                                VerticalAlignment = VerticalAlignment.Center,
                                ToolTip = $"\u00D8 Session-Dauer f\u00FCr {platform} anpassen",
                                Template = durBtnTempl
                            };

                            // Clicking opens an inline editor (TextBox replaces button)
                            var capturedPlatform = platform;
                            var capturedRange = range;
                            durBtn.Click += (_, __) =>
                            {
                                var editBox = new TextBox
                                {
                                    Text = sessionDur.ToString(),
                                    Width = 40,
                                    FontSize = 11,
                                    Background = new SolidColorBrush(inputBgColor),
                                    Foreground = new SolidColorBrush(textColor),
                                    CaretBrush = new SolidColorBrush(textColor),
                                    BorderBrush = new SolidColorBrush(accent2Color),
                                    BorderThickness = new Thickness(1),
                                    HorizontalAlignment = HorizontalAlignment.Right,
                                    Padding = new Thickness(2),
                                    HorizontalContentAlignment = HorizontalAlignment.Center
                                };
                                Grid.SetColumn(editBox, 2);

                                async void CommitEdit()
                                {
                                    if (int.TryParse(editBox.Text.Trim(), out var newVal) && newVal > 0 && newVal <= 120)
                                    {
                                        try
                                        {
                                            using var httpEdit = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                                            var payload = JsonSerializer.Serialize(new Dictionary<string, int> { { capturedPlatform, newVal } });
                                            await httpEdit.PostAsync($"{CompanionBaseUrl()}/stats/session-durations", new StringContent(payload, Encoding.UTF8, "application/json"));
                                        }
                                        catch { /* ignore */ }
                                    }
                                    LoadStats(capturedRange);
                                }

                                editBox.KeyDown += (_, ke) =>
                                {
                                    if (ke.Key == System.Windows.Input.Key.Enter) { ke.Handled = true; CommitEdit(); }
                                    if (ke.Key == System.Windows.Input.Key.Escape) { ke.Handled = true; LoadStats(capturedRange); }
                                };
                                editBox.LostFocus += (_, __2) => CommitEdit();

                                // Replace button with textbox
                                row.Children.Remove(durBtn);
                                row.Children.Add(editBox);
                                editBox.Focus();
                                editBox.SelectAll();
                            };

                            var minsLabel = new TextBlock
                            {
                                Text = $"{mins} min",
                                Foreground = new SolidColorBrush(accentColor),
                                FontSize = 13,
                                FontWeight = FontWeights.SemiBold,
                                HorizontalAlignment = HorizontalAlignment.Right,
                                VerticalAlignment = VerticalAlignment.Center
                            };

                            Grid.SetColumn(platformLabel, 0);
                            Grid.SetColumn(countLabel, 1);
                            Grid.SetColumn(durBtn, 2);
                            Grid.SetColumn(minsLabel, 3);

                            row.Children.Add(platformLabel);
                            row.Children.Add(countLabel);
                            row.Children.Add(durBtn);
                            row.Children.Add(minsLabel);
                            statsPlatformList.Children.Add(row);
                        }
                    }

                    if (totalBlocks == 0)
                    {
                        var emptyMsg = new TextBlock
                        {
                            Text = "Noch keine Ablenkungen blockiert.\nSurf einfach weiter \u2014 Spark passt auf!",
                            Foreground = new SolidColorBrush(mutedColor),
                            FontSize = 13,
                            TextWrapping = TextWrapping.Wrap,
                            HorizontalAlignment = HorizontalAlignment.Center,
                            TextAlignment = TextAlignment.Center,
                            Margin = new Thickness(0, 20, 0, 0)
                        };
                        statsPlatformList.Children.Add(emptyMsg);
                    }
                });
            }
            catch { /* companion not reachable */ }
        }

        // -- Composer --
        var composerBorder = new Border
        {
            BorderBrush = new SolidColorBrush(borderColor),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(12, 12, 12, 12)
        };
        var composerGrid = new Grid();
        composerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        composerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        composerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        composerBorder.Child = composerGrid;

        // Mic button (left)
        var micBtnTemplate = new ControlTemplate(typeof(Button));
        var micBorderFactory = new FrameworkElementFactory(typeof(Border));
        micBorderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(inputBgColor));
        micBorderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
        micBorderFactory.SetValue(Border.BorderBrushProperty, new SolidColorBrush(borderColor));
        micBorderFactory.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        var micContent = new FrameworkElementFactory(typeof(ContentPresenter));
        micContent.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        micContent.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        micBorderFactory.AppendChild(micContent);
        micBtnTemplate.VisualTree = micBorderFactory;

        // SVG-style mic icon via WPF Path (matches Browser/Onboarding mic button style)
        var micPath = new System.Windows.Shapes.Path
        {
            Stroke = new SolidColorBrush(textColor),
            StrokeThickness = 1.8,
            StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            Fill = Brushes.Transparent,
            Data = Geometry.Parse("M10,1 C8.34,1 7,2.34 7,4 L7,12 C7,13.66 8.34,15 10,15 C11.66,15 13,13.66 13,12 L13,4 C13,2.34 11.66,1 10,1 Z M17,8.5 L17,10.5 C17,14.37 13.87,17.5 10,17.5 C6.13,17.5 3,14.37 3,10.5 L3,8.5 M10,17.5 L10,20.5 M7,20.5 L13,20.5"),
            Width = 18,
            Height = 20,
            Stretch = Stretch.Uniform
        };
        var micIconContainer = new Viewbox
        {
            Width = 18,
            Height = 18,
            Child = micPath
        };

        // The mic button border we'll style dynamically for recording state
        var micBorder = new Border
        {
            Width = 42,
            Height = 42,
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(inputBgColor),
            BorderBrush = new SolidColorBrush(borderColor),
            BorderThickness = new Thickness(1),
            Child = micIconContainer
        };

        var actionBtn = new Button
        {
            Content = micBorder,
            Width = 42,
            Height = 42,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Template = micBtnTemplate
        };
        Grid.SetColumn(actionBtn, 0);
        composerGrid.Children.Add(actionBtn);

        // Input field
        var inputWrap = new Border
        {
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(inputBgColor),
            BorderBrush = new SolidColorBrush(borderColor),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(8, 0, 8, 0)
        };
        var inputInner = new Grid();
        inputWrap.Child = inputInner;

        var placeholder = new TextBlock
        {
            Text = "Nachricht... (Ctrl+Enter)",
            Foreground = new SolidColorBrush(mutedColor),
            Margin = new Thickness(2, 2, 2, 0),
            FontSize = 13,
            IsHitTestVisible = false
        };
        inputInner.Children.Add(placeholder);

        var input = new TextBox
        {
            Background = Brushes.Transparent,
            Foreground = new SolidColorBrush(textColor),
            CaretBrush = new SolidColorBrush(textColor),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(2, 0, 2, 0),
            FontSize = 13,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MaxHeight = 200,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        inputInner.Children.Add(input);
        Grid.SetColumn(inputWrap, 1);
        composerGrid.Children.Add(inputWrap);

        // -- Wave container (replaces input during recording) --
        var waveContainer = new Border
        {
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(Color.FromArgb(15, 248, 113, 113)), // danger 6% opacity
            BorderBrush = new SolidColorBrush(Color.FromArgb(64, 248, 113, 113)), // danger 25% opacity
            BorderThickness = new Thickness(1),
            Height = 42,
            Margin = new Thickness(8, 0, 8, 0),
            Visibility = Visibility.Collapsed
        };
        var waveInner = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        // Create 11 wave bars
        var waveBars = new System.Windows.Shapes.Rectangle[11];
        var waveBaseHeights = new double[] { 6, 14, 22, 28, 22, 14, 18, 10, 24, 16, 8 };
        var wavePhases = new double[] { 0, 0.5, 1.0, 1.5, 0.75, 1.25, 1.75, 2.0, 0.25, 2.25, 2.5 };
        for (int i = 0; i < 11; i++)
        {
            var bar = new System.Windows.Shapes.Rectangle
            {
                Width = 3,
                Height = waveBaseHeights[i],
                RadiusX = 1.5,
                RadiusY = 1.5,
                Margin = new Thickness(1.5, 0, 1.5, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            var barGrad = new LinearGradientBrush
            {
                StartPoint = new Point(0.5, 0),
                EndPoint = new Point(0.5, 1)
            };
            barGrad.GradientStops.Add(new GradientStop(dangerColor, 0));
            barGrad.GradientStops.Add(new GradientStop(Color.FromArgb(102, 248, 113, 113), 1));
            bar.Fill = barGrad;
            waveBars[i] = bar;
            waveInner.Children.Add(bar);
        }
        // Rec time label
        var recTimeLabel = new TextBlock
        {
            Text = "0s",
            Foreground = new SolidColorBrush(dangerColor),
            FontSize = 11,
            FontWeight = FontWeights.Bold,
            Margin = new Thickness(10, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        waveInner.Children.Add(recTimeLabel);
        // Stop button (red square)
        var stopBtnTemplate = new ControlTemplate(typeof(Button));
        var stopBorderFact = new FrameworkElementFactory(typeof(Border));
        stopBorderFact.SetValue(Border.BackgroundProperty, new SolidColorBrush(dangerColor));
        stopBorderFact.SetValue(Border.CornerRadiusProperty, new CornerRadius(6));
        var stopContent = new FrameworkElementFactory(typeof(ContentPresenter));
        stopContent.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        stopContent.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        stopBorderFact.AppendChild(stopContent);
        stopBtnTemplate.VisualTree = stopBorderFact;
        var recStopBtn = new Button
        {
            Width = 24,
            Height = 24,
            Margin = new Thickness(6, 0, 0, 0),
            Template = stopBtnTemplate,
            BorderThickness = new Thickness(0),
            VerticalAlignment = VerticalAlignment.Center
        };
        // White square inside
        var stopSquare = new System.Windows.Shapes.Rectangle
        {
            Width = 8, Height = 8,
            RadiusX = 2, RadiusY = 2,
            Fill = Brushes.White
        };
        recStopBtn.Content = stopSquare;
        waveInner.Children.Add(recStopBtn);
        waveContainer.Child = waveInner;
        Grid.SetColumn(waveContainer, 1);
        composerGrid.Children.Add(waveContainer);

        // Wave animation timer
        var waveAnimTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(60) };
        var waveTime = 0.0;
        waveAnimTimer.Tick += (_, __) =>
        {
            waveTime += 0.12;
            for (int i = 0; i < waveBars.Length; i++)
            {
                var scale = 0.3 + 0.7 * (0.5 + 0.5 * Math.Sin(waveTime * 3.0 + wavePhases[i] * 2.0));
                waveBars[i].Height = waveBaseHeights[i] * scale;
                waveBars[i].Opacity = 0.4 + 0.6 * scale;
            }
        };

        // Send button (right)
        var sendBtnTemplate = new ControlTemplate(typeof(Button));
        var sendBorderFactory = new FrameworkElementFactory(typeof(Border));
        sendBorderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(accentColor));
        sendBorderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
        var sendContent = new FrameworkElementFactory(typeof(ContentPresenter));
        sendContent.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        sendContent.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        sendBorderFactory.AppendChild(sendContent);
        sendBtnTemplate.VisualTree = sendBorderFactory;

        var sendBtn = new Button
        {
            Content = "➤",
            Width = 42,
            Height = 42,
            Foreground = new SolidColorBrush(Color.FromRgb(6, 32, 22)),
            FontWeight = FontWeights.Bold,
            BorderThickness = new Thickness(0),
            Template = sendBtnTemplate
        };
        Grid.SetColumn(sendBtn, 2);
        composerGrid.Children.Add(sendBtn);

        expanded.Children.Add(composerBorder);
        Grid.SetRow(composerBorder, 2);

        // -- Stats mode toggle (after composer is declared) --
        void SetStatsMode(bool on)
        {
            statsMode = on;
            if (on)
            {
                scroll.Visibility = Visibility.Collapsed;
                composerBorder.Visibility = Visibility.Collapsed;
                statsScroll.Visibility = Visibility.Visible;
                statsBtn.Foreground = new SolidColorBrush(accentColor);
                LoadStats(currentRange);
            }
            else
            {
                scroll.Visibility = Visibility.Visible;
                composerBorder.Visibility = Visibility.Visible;
                statsScroll.Visibility = Visibility.Collapsed;
                statsBtn.Foreground = new SolidColorBrush(mutedColor);
            }
        }

        statsBtn.Click += (_, __) => SetStatsMode(!statsMode);
        rangeBtnToday.Click += (_, __) => { currentRange = "today"; SetRangeButtonStyles("today"); LoadStats("today"); };
        rangeBtnWeek.Click += (_, __) => { currentRange = "week"; SetRangeButtonStyles("week"); LoadStats("week"); };
        rangeBtnTotal.Click += (_, __) => { currentRange = "total"; SetRangeButtonStyles("total"); LoadStats("total"); };

        // -- Status bar --
        var statusText = new TextBlock
        {
            Text = "Bereit.",
            Foreground = new SolidColorBrush(mutedColor),
            FontSize = 11,
            Margin = new Thickness(16, 4, 16, 8)
        };
        expanded.Children.Add(statusText);
        Grid.SetRow(statusText, 3);

        // -- Message rendering --
        void AddMsg(string role, string text, bool isUser)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(isUser ? 40 : 0, 0, isUser ? 0 : 40, 8),
                HorizontalAlignment = isUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
                MaxWidth = 500
            };
            if (isUser)
            {
                bubble.Background = new SolidColorBrush(Color.FromRgb(14, 25, 50));
                bubble.BorderBrush = new SolidColorBrush(borderColor);
                bubble.BorderThickness = new Thickness(1);
            }
            else
            {
                bubble.Background = new SolidColorBrush(Color.FromRgb(11, 20, 35));
            }
            var msgColor = isUser ? accent2Color : accentColor;
            if (role == "System") msgColor = mutedColor;
            var textBlock = new TextBlock
            {
                Text = text,
                Foreground = new SolidColorBrush(msgColor),
                TextWrapping = TextWrapping.Wrap,
                FontSize = 13,
                LineHeight = 20
            };
            bubble.Child = textBlock;
            messages.Children.Add(bubble);
            scroll.ScrollToEnd();
        }

        // Bug report mode flag — declared before SendMessage() which references it
        bool bugReportMode = false;

        async void SendMessage()
        {
            var text = input.Text.Trim();
            if (string.IsNullOrWhiteSpace(text)) return;
            input.Text = "";

            if (bugReportMode)
            {
                AddMsg("Du", "🐛 " + text, true);
                try
                {
                    using var http = new HttpClient();
                    var payload = JsonSerializer.Serialize(new { description = text });
                    var res = await http.PostAsync($"{CompanionBaseUrl()}/bug-report", new StringContent(payload, Encoding.UTF8, "application/json"));
                    if (res.IsSuccessStatusCode)
                        AddMsg("System", "Bug-Report gespeichert. Danke!", false);
                    else
                        AddMsg("System", $"Fehler beim Speichern ({res.StatusCode}).", false);
                }
                catch (Exception ex)
                {
                    AddMsg("System", $"Fehler: {ex.Message}", false);
                }
                SetBugMode(false);
                return;
            }

            AddMsg("Du", text, true);
            try
            {
                using var http = new HttpClient();
                var payload = JsonSerializer.Serialize(new { message = text, timestamp = DateTime.UtcNow.ToString("o") });
                var res = await http.PostAsync($"{CompanionBaseUrl()}/chat", new StringContent(payload, Encoding.UTF8, "application/json"));
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("reply", out var replyEl))
                {
                    AddMsg("Spark", replyEl.GetString() ?? "", false);
                }
                if (doc.RootElement.TryGetProperty("memorySummary", out var summaryEl) &&
                    summaryEl.ValueKind == JsonValueKind.Array)
                {
                    var items = new System.Collections.Generic.List<string>();
                    foreach (var item in summaryEl.EnumerateArray())
                    {
                        var s = item.GetString();
                        if (!string.IsNullOrWhiteSpace(s)) items.Add(s);
                    }
                    if (items.Count > 0)
                        AddMsg("System", "Memory: " + string.Join(" · ", items), false);
                }
                else if (doc.RootElement.TryGetProperty("memoryUpdated", out var memEl) && memEl.ValueKind == JsonValueKind.True)
                {
                    AddMsg("System", "Memory aktualisiert.", false);
                }
                if (doc.RootElement.TryGetProperty("openUrl", out var urlEl))
                {
                    var url = urlEl.GetString() ?? "";
                    if (!string.IsNullOrWhiteSpace(url))
                    {
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    }
                }
            }
            catch
            {
                // ignore status text
            }
        }

        bool hasCustomPos = false;
        double customLeft = 0;
        double customTop = 0;
        const double SnapRadius = 120;

        (double left, double top) AnchorPosition(double width, double height)
        {
            var margin = 16;
            var work = SystemParameters.WorkArea;
            var left = work.Right - width - margin;
            var top = work.Bottom - height - margin;
            return (left, top);
        }

        (double w, double h) ExpandedSize()
        {
            var work = SystemParameters.WorkArea;
            var w = Math.Max(360, Math.Min(680, (int)(work.Width / 3)));
            var h = Math.Max(400, (int)(work.Height * 0.85));
            return (w, h);
        }

        void PositionWindow(Window target, bool expandedState)
        {
            var es = ExpandedSize();
            var width = expandedState ? es.w : target.Width;
            var height = expandedState ? es.h : target.Height;
            if (hasCustomPos && !expandedState)
            {
                target.Left = customLeft;
                target.Top = customTop;
                return;
            }
            if (hasCustomPos && expandedState)
            {
                target.Left = customLeft - (width - IconSize);
                target.Top = customTop - (height - IconSize);
                return;
            }
            var anchor = AnchorPosition(width, height);
            target.Left = anchor.left;
            target.Top = anchor.top;
        }

        void SnapIfNearAnchor(Window target)
        {
            var anchor = AnchorPosition(IconSize, IconSize);
            var dx = target.Left - anchor.left;
            var dy = target.Top - anchor.top;
            var dist = Math.Sqrt(dx * dx + dy * dy);
            if (dist <= SnapRadius)
            {
                hasCustomPos = false;
                target.Left = anchor.left;
                target.Top = anchor.top;
            }
            else
            {
                hasCustomPos = true;
                customLeft = target.Left;
                customTop = target.Top;
            }
        }

        void SetExpanded(bool expandedState)
        {
            collapsed.Visibility = expandedState ? Visibility.Collapsed : Visibility.Visible;
            expanded.Visibility = expandedState ? Visibility.Visible : Visibility.Collapsed;
            if (expandedState)
            {
                var es = ExpandedSize();
                window.Width = es.w;
                window.Height = es.h;
                card.Background = new SolidColorBrush(panelColor);
                card.BorderBrush = new SolidColorBrush(borderColor);
                card.BorderThickness = new Thickness(1);
                card.CornerRadius = new CornerRadius(16);
                card.Effect = dropShadow;
                input.Focus();
            }
            else
            {
                window.Width = IconSize;
                window.Height = IconSize;
                card.Background = Brushes.Transparent;
                card.BorderBrush = Brushes.Transparent;
                card.BorderThickness = new Thickness(0);
                card.CornerRadius = new CornerRadius(999); // circular FAB
                card.Effect = null;
            }
            PositionWindow(window, expandedState);
        }

        iconButton.Click += (_, __) => SetExpanded(true);

        // -- Bug/Feedback report mode --
        var bugModeIndicator = new SolidColorBrush(Color.FromRgb(251, 191, 36)); // amber/warning

        void SetBugMode(bool on)
        {
            bugReportMode = on;
            if (on)
            {
                placeholder.Text = "Bug oder Feedback beschreiben...";
                statusText.Text = "\U0001F41B Bug/Feedback — Beschreibe und sende ab.";
                statusText.Foreground = bugModeIndicator;
                bugBtn.Foreground = bugModeIndicator;
            }
            else
            {
                placeholder.Text = "Nachricht... (Ctrl+Enter)";
                statusText.Text = "Bereit.";
                statusText.Foreground = new SolidColorBrush(mutedColor);
                bugBtn.Foreground = new SolidColorBrush(mutedColor);
            }
        }

        bugBtn.Click += (_, __) => SetBugMode(!bugReportMode);

        bool dictating = false;
        bool transcribing = false;
        bool recording = false;
        WasapiCapture? wasapiCapture = null;
        WaveInEvent? waveInFallback = null;
        MemoryStream? audioBuffer = null;
        var dictationTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(140) };
        // Nur für „Transkribiere…“-Status — niemals actionBtn.Content überschreiben (sonst verschwindet Mic+roter Rand wie im HTML-Chat).
        var transcribeFrames = new[] { "⏳", "⏳.", "⏳..", "⏳..." };
        var frameIdx = 0;
        dictationTimer.Tick += (_, __) =>
        {
            if (!transcribing) return;
            statusText.Text = transcribeFrames[frameIdx % transcribeFrames.Length] + " Transkribiere...";
            frameIdx += 1;
        };

        DateTime recStartTime = DateTime.MinValue;
        var recTimerDisp = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        recTimerDisp.Tick += (_, __) =>
        {
            var secs = (int)(DateTime.Now - recStartTime).TotalSeconds;
            recTimeLabel.Text = secs + "s";
        };

        void SetMicNormal()
        {
            micBorder.Background = new SolidColorBrush(inputBgColor);
            micBorder.BorderBrush = new SolidColorBrush(borderColor);
            micBorder.BorderThickness = new Thickness(1);
            micBorder.Effect = null;
            micPath.Stroke = new SolidColorBrush(textColor);
            micIconContainer.Visibility = Visibility.Visible;
            actionBtn.Content = micBorder;
        }

        void SetMicRecording()
        {
            micBorder.Background = new SolidColorBrush(Color.FromArgb(30, 248, 113, 113)); // danger 12%
            micBorder.BorderBrush = new SolidColorBrush(dangerColor);
            micBorder.BorderThickness = new Thickness(1.5);
            micBorder.Effect = new System.Windows.Media.Effects.DropShadowEffect
            {
                Color = Color.FromRgb(239, 68, 68),
                BlurRadius = 12,
                ShadowDepth = 0,
                Opacity = 0.2
            };
            micPath.Stroke = new SolidColorBrush(dangerColor);
            actionBtn.Content = micBorder;
        }

        void StopDictationUi()
        {
            dictating = false;
            transcribing = false;
            dictationTimer.Stop();
            waveAnimTimer.Stop();
            recTimerDisp.Stop();
            inputWrap.Visibility = Visibility.Visible;
            waveContainer.Visibility = Visibility.Collapsed;
            SetMicNormal();
            statusText.Text = "Bereit.";
        }

        void StartDictationUi()
        {
            dictating = true;
            transcribing = false;
            frameIdx = 0;
            recStartTime = DateTime.Now;
            recTimeLabel.Text = "0s";
            // Show wave, hide input (wie Onboarding: .wave-container.active + .btn.mic.recording)
            inputWrap.Visibility = Visibility.Collapsed;
            waveContainer.Visibility = Visibility.Visible;
            waveTime = 0;
            SetMicRecording();
            statusText.Text = "Aufnahme...";
            // Kein dictationTimer während Aufnahme — Wellen laufen über waveAnimTimer
            waveAnimTimer.Start();
            recTimerDisp.Start();
        }

        void ShowTranscribingUi()
        {
            dictating = false;
            transcribing = true;
            frameIdx = 0;
            waveAnimTimer.Stop();
            recTimerDisp.Stop();
            inputWrap.Visibility = Visibility.Visible;
            waveContainer.Visibility = Visibility.Collapsed;
            SetMicNormal();
            micPath.Stroke = new SolidColorBrush(mutedColor);
            statusText.Text = "⏳ Transkribiere...";
            dictationTimer.Start();
        }

        // 16 kHz mono für Whisper; Browser-UI nutzt getUserMedia + WebM (ein Blob, kein Timeslice).
        // Native: frische Capture-Session pro Aufnahme, WASAPI „Communications“ (Sprachpfad) + Resample → PCM16 @ 16 kHz.
        const int minPcm16Bytes = 16000; // ~0,5 s @ 16 kHz 16-bit mono — analog „nicht fast leer senden“ (HTML: min WebM ~500 B).

        async Task OnMicCaptureStoppedAsync(byte[] raw, WaveFormat? wasapiSourceFormat)
        {
            var data = raw;
            if (wasapiSourceFormat != null && raw.Length > 0)
            {
                try
                {
                    // Use ISampleProvider chain (pure managed) instead of MediaFoundationResampler
                    // which can silently produce garbage from WASAPI's native float32/stereo formats.
                    Console.Error.WriteLine($"[spark:stt] WASAPI source: {wasapiSourceFormat} (channels={wasapiSourceFormat.Channels}, rate={wasapiSourceFormat.SampleRate}, bits={wasapiSourceFormat.BitsPerSample})");
                    using var ms = new MemoryStream(raw);
                    using var source = new RawSourceWaveStream(ms, wasapiSourceFormat);
                    ISampleProvider pipeline = source.ToSampleProvider();
                    // Multi-channel → mono: ToMono() only handles stereo (2ch).
                    // For >2 channels, take the first channel via MultiplexingSampleProvider.
                    if (pipeline.WaveFormat.Channels == 2)
                        pipeline = pipeline.ToMono();
                    else if (pipeline.WaveFormat.Channels > 2)
                        pipeline = new NAudio.Wave.SampleProviders.MultiplexingSampleProvider(
                            new[] { pipeline }, 1);
                    // Resample to 16 kHz via WDL resampler (reliable, no COM/MFT dependency)
                    if (pipeline.WaveFormat.SampleRate != 16000)
                        pipeline = new NAudio.Wave.SampleProviders.WdlResamplingSampleProvider(pipeline, 16000);
                    // Float → 16-bit PCM
                    var pcm16Provider = pipeline.ToWaveProvider16();
                    using var outMs = new MemoryStream();
                    var buf = new byte[4096];
                    int read;
                    while ((read = pcm16Provider.Read(buf, 0, buf.Length)) > 0)
                        outMs.Write(buf, 0, read);
                    data = outMs.ToArray();
                    Console.Error.WriteLine($"[spark:stt] WASAPI resample: {wasapiSourceFormat} ({raw.Length} bytes) → 16kHz mono PCM16 ({data.Length} bytes)");
                }
                catch (Exception ex)
                {
                    input.Dispatcher.Invoke(() =>
                    {
                        AddMsg("System", $"Audio-Aufbereitung (WASAPI→16 kHz): {ex.Message}", false);
                        StopDictationUi();
                    });
                    return;
                }
            }

            if (data.Length < minPcm16Bytes)
            {
                input.Dispatcher.Invoke(() =>
                {
                    AddMsg("System", "Aufnahme zu kurz.", false);
                    StopDictationUi();
                });
                return;
            }

            input.Dispatcher.Invoke(() => ShowTranscribingUi());

            try
            {
                // POST /stt (Companion runStt → Whisper): { audioBase64, mimeType, sampleRate? }
                // Browser-WebM: audio/webm; Native: audio/pcm → serverseitig WAV.
                using var http = new HttpClient();
                http.Timeout = TimeSpan.FromSeconds(120);
                var payload = JsonSerializer.Serialize(new
                {
                    audioBase64 = Convert.ToBase64String(data),
                    mimeType = "audio/pcm",
                    sampleRate = 16000
                });
                var res = await http.PostAsync($"{CompanionBaseUrl()}/stt", new StringContent(payload, Encoding.UTF8, "application/json"));
                var json = await res.Content.ReadAsStringAsync();

                if (!res.IsSuccessStatusCode)
                {
                    var errFromBody = "";
                    try
                    {
                        using var errDoc = JsonDocument.Parse(json);
                        if (errDoc.RootElement.TryGetProperty("error", out var errEl))
                            errFromBody = errEl.GetString() ?? "";
                    }
                    catch { /* ignore */ }
                    var displayErr = string.IsNullOrWhiteSpace(errFromBody) ? json : errFromBody;
                    if (displayErr.Length > 280) displayErr = displayErr.Substring(0, 277) + "...";
                    input.Dispatcher.Invoke(() =>
                    {
                        AddMsg("System", $"Transkription fehlgeschlagen ({res.StatusCode}): {displayErr}", false);
                        StopDictationUi();
                    });
                    return;
                }

                using var doc = JsonDocument.Parse(json);

                if (doc.RootElement.TryGetProperty("error", out var errEl2))
                {
                    var errMsg = errEl2.GetString() ?? "unbekannter Fehler";
                    input.Dispatcher.Invoke(() =>
                    {
                        AddMsg("System", $"STT: {errMsg}", false);
                        StopDictationUi();
                    });
                    return;
                }

                if (doc.RootElement.TryGetProperty("text", out var textEl))
                {
                    var transcript = (textEl.GetString() ?? "").Trim();
                    input.Dispatcher.Invoke(() =>
                    {
                        if (!string.IsNullOrWhiteSpace(transcript))
                        {
                            // Wie HTML-Chat: an bestehenden Text anhängen (nicht ersetzen)
                            var cur = (input.Text ?? "").TrimEnd();
                            input.Text = string.IsNullOrEmpty(cur) ? transcript : cur + " " + transcript;
                            input.CaretIndex = input.Text.Length;
                            input.Focus();
                        }
                        else
                        {
                            AddMsg("System", "Nichts erkannt. Bitte nochmal versuchen.", false);
                        }
                        StopDictationUi();
                    });
                }
                else
                {
                    input.Dispatcher.Invoke(() =>
                    {
                        AddMsg("System", "Unerwartete Antwort vom STT-Server.", false);
                        StopDictationUi();
                    });
                }
            }
            catch (Exception ex)
            {
                input.Dispatcher.Invoke(() =>
                {
                    AddMsg("System", $"Transkription-Fehler: {ex.Message}", false);
                    StopDictationUi();
                });
            }
        }

        void StartRecording()
        {
            if (recording) return;
            recording = true;
            audioBuffer = new MemoryStream();
            wasapiCapture = null;
            waveInFallback = null;

            MMDevice? micDevice = null;
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                try
                {
                    micDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
                }
                catch
                {
                    try
                    {
                        micDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
                    }
                    catch
                    {
                        micDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia);
                    }
                }
            }
            catch (Exception ex)
            {
                recording = false;
                audioBuffer = null;
                input.Dispatcher.Invoke(() =>
                {
                    AddMsg("System", $"Mikrofon-Fehler: {ex.Message}", false);
                    StopDictationUi();
                });
                return;
            }

            try
            {
                wasapiCapture = new WasapiCapture(micDevice);
            }
            catch (Exception ex)
            {
                micDevice.Dispose();
                try
                {
                    waveInFallback = new WaveInEvent
                    {
                        WaveFormat = new WaveFormat(16000, 16, 1),
                        BufferMilliseconds = 100
                    };
                }
                catch (Exception ex2)
                {
                    recording = false;
                    audioBuffer = null;
                    input.Dispatcher.Invoke(() =>
                    {
                        AddMsg("System", $"Mikrofon-Fehler: {ex.Message} / Fallback: {ex2.Message}", false);
                        StopDictationUi();
                    });
                    return;
                }

                waveInFallback.DataAvailable += (_, e) =>
                {
                    audioBuffer?.Write(e.Buffer, 0, e.BytesRecorded);
                };
                waveInFallback.RecordingStopped += async (_, __) =>
                {
                    waveInFallback?.Dispose();
                    waveInFallback = null;
                    recording = false;
                    var raw = audioBuffer?.ToArray() ?? Array.Empty<byte>();
                    audioBuffer = null;
                    await OnMicCaptureStoppedAsync(raw, null);
                };
                waveInFallback.StartRecording();
                return;
            }

            var captureFormat = wasapiCapture.WaveFormat;
            wasapiCapture.DataAvailable += (_, e) =>
            {
                audioBuffer?.Write(e.Buffer, 0, e.BytesRecorded);
            };
            wasapiCapture.RecordingStopped += async (_, __) =>
            {
                wasapiCapture?.Dispose();
                wasapiCapture = null;
                recording = false;
                var raw = audioBuffer?.ToArray() ?? Array.Empty<byte>();
                audioBuffer = null;
                await OnMicCaptureStoppedAsync(raw, captureFormat);
            };
            wasapiCapture.StartRecording();
        }

        void StopRecording()
        {
            if (!recording) return;
            wasapiCapture?.StopRecording();
            waveInFallback?.StopRecording();
        }

        void UpdateActionState()
        {
            if (dictating || transcribing) return;
            SetMicNormal();
            placeholder.Visibility = (input.Text.Length > 0 || input.IsFocused) ? Visibility.Collapsed : Visibility.Visible;
        }

        // Mic button: toggle recording
        actionBtn.Click += (_, __) =>
        {
            if (transcribing) return;
            if (recording)
            {
                StopRecording();
                return;
            }
            input.Focus();
            StartDictationUi();
            StartRecording();
        };

        // Stop recording button in wave container
        recStopBtn.Click += (_, __) => { if (recording) StopRecording(); };

        // Send button
        sendBtn.Click += (_, __) => SendMessage();

        input.KeyDown += (s, e) =>
        {
            if (e.Key == System.Windows.Input.Key.Enter &&
                (System.Windows.Input.Keyboard.Modifiers & System.Windows.Input.ModifierKeys.Control) != 0)
            {
                e.Handled = true;
                SendMessage();
            }
        };
        input.GotFocus += (_, __) => UpdateActionState();
        input.TextChanged += (_, __) =>
        {
            if (dictating && !transcribing) StopDictationUi();
            if (!transcribing) UpdateActionState();
        };
        input.LostFocus += (_, __) => UpdateActionState();

        bool dragging = false;
        bool dragged = false;
        Point dragStart = new Point();
        Point windowStart = new Point();

        iconButton.PreviewMouseLeftButtonDown += (s, e) =>
        {
            dragStart = window.PointToScreen(e.GetPosition(window));
            windowStart = new Point(window.Left, window.Top);
            dragging = true;
            dragged = false;
            iconButton.CaptureMouse();
        };

        iconButton.PreviewMouseMove += (s, e) =>
        {
            if (!dragging) return;
            var current = window.PointToScreen(e.GetPosition(window));
            var dx = current.X - dragStart.X;
            var dy = current.Y - dragStart.Y;
            if (Math.Abs(dx) > 3 || Math.Abs(dy) > 3) dragged = true;
            window.Left = windowStart.X + dx;
            window.Top = windowStart.Y + dy;
        };

        iconButton.PreviewMouseLeftButtonUp += (s, e) =>
        {
            if (!dragging) return;
            dragging = false;
            iconButton.ReleaseMouseCapture();
            if (!dragged)
            {
                SetExpanded(true);
                return;
            }
            SnapIfNearAnchor(window);
        };

        window.Loaded += async (_, __) =>
        {
            PositionWindow(window, false);
            UpdateActionState();
            // Check for post-onboarding welcome message
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                var initRes = await http.GetAsync($"{CompanionBaseUrl()}/overlay/init");
                if (initRes.IsSuccessStatusCode)
                {
                    var initJson = await initRes.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(initJson);
                    if (doc.RootElement.TryGetProperty("welcome", out var welcomeEl) &&
                        welcomeEl.ValueKind == JsonValueKind.String)
                    {
                        var welcomeText = welcomeEl.GetString() ?? "";
                        if (!string.IsNullOrWhiteSpace(welcomeText))
                        {
                            AddMsg("Spark", welcomeText, false);
                            SetExpanded(true);
                        }
                    }
                }
            }
            catch
            {
                // companion not ready yet — ignore, user can still click the FAB
            }
        };
        window.Deactivated += (_, __) =>
        {
            if (expanded.Visibility == Visibility.Visible)
            {
                SetExpanded(false);
            }
        };
        return window;
    }

    private static int RunQuoteToast(string text, string author)
    {
        try
        {
            HideConsoleWindow();
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var window = BuildQuoteToast(text, author);
            window.Closed += (_, __) => app.Shutdown();
            window.Show();
            app.Run();
            return 0;
        }
        catch { return 1; }
    }

    private static Window BuildQuoteToast(string text, string author)
    {
        var safeText = (text ?? "").Trim();
        var safeAuthor = (author ?? "").Trim();
        var hasAuthor = !string.IsNullOrWhiteSpace(safeAuthor);

        var window = new Window
        {
            Width = 460,
            SizeToContent = SizeToContent.Height,
            MaxHeight = 420,
            Topmost = true,
            WindowStyle = WindowStyle.None,
            ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false,
            ShowActivated = false,
            AllowsTransparency = true,
            Background = Brushes.Transparent
        };

        // Make toast non-activating: it won't steal focus from whatever the user is doing.
        // Only mouse clicks on the thumb buttons will interact with it.
        window.SourceInitialized += (_, __) =>
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            var exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
        };

        // -- Outer card --
        var root = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(17, 24, 45)),  // #11182d
            BorderBrush = new SolidColorBrush(Color.FromRgb(36, 48, 79)),  // #24304f
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(28, 22, 28, 22),
            Effect = new System.Windows.Media.Effects.DropShadowEffect
            {
                Color = Color.FromRgb(0, 0, 0),
                BlurRadius = 40,
                ShadowDepth = 16,
                Opacity = 0.55,
                Direction = 270
            }
        };

        // Use a Grid so we can overlay the feedback buttons top-right
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // -- Left: quote content --
        var contentStack = new StackPanel { Margin = new Thickness(0, 0, 50, 0) };
        Grid.SetRow(contentStack, 0);
        Grid.SetColumn(contentStack, 0);

        // Decorative quote mark
        var quoteMark = new TextBlock
        {
            Text = "\u201C",
            FontFamily = new FontFamily("Georgia"),
            FontSize = 42,
            Foreground = new SolidColorBrush(Color.FromArgb(60, 74, 138, 245)),
            Margin = new Thickness(0, 0, 0, 2)
        };
        contentStack.Children.Add(quoteMark);

        // Quote text
        var quoteBlock = new TextBlock
        {
            Text = safeText,
            Foreground = new SolidColorBrush(Color.FromRgb(219, 231, 255)),  // #dbe7ff
            TextWrapping = TextWrapping.Wrap,
            FontSize = 17,
            LineHeight = 26,
            Margin = new Thickness(0, 0, 0, hasAuthor ? 10 : 0)
        };
        contentStack.Children.Add(quoteBlock);

        // Author
        if (hasAuthor)
        {
            var authorBlock = new TextBlock
            {
                Text = $"\u2014 {safeAuthor}",
                Foreground = new SolidColorBrush(Color.FromRgb(149, 163, 199)),
                FontSize = 13,
                FontStyle = FontStyles.Italic,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 4, 0, 0)
            };
            contentStack.Children.Add(authorBlock);
        }

        grid.Children.Add(contentStack);

        // -- Right: thumb buttons (top-right corner) --
        var btnStack = new StackPanel
        {
            Orientation = Orientation.Vertical,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right
        };
        Grid.SetRow(btnStack, 0);
        Grid.SetColumn(btnStack, 1);

        var upBtn = BuildThumbButton("\U0001F44D", Color.FromRgb(13, 37, 32), Color.FromRgb(134, 239, 172), Color.FromRgb(26, 74, 58));
        upBtn.Margin = new Thickness(0, 0, 0, 6);
        var downBtn = BuildThumbButton("\U0001F44E", Color.FromRgb(42, 13, 13), Color.FromRgb(252, 165, 165), Color.FromRgb(74, 26, 26));

        btnStack.Children.Add(upBtn);
        btnStack.Children.Add(downBtn);
        grid.Children.Add(btnStack);

        root.Child = grid;
        window.Content = root;

        async void SendFeedback(string rating)
        {
            try
            {
                using var http = new HttpClient();
                var payload = JsonSerializer.Serialize(new { text = safeText, author = safeAuthor, feedback = rating });
                await http.PostAsync($"{CompanionBaseUrl()}/quote/feedback", new StringContent(payload, Encoding.UTF8, "application/json"));
            }
            catch { /* ignore */ }
        }

        upBtn.Click += (_, __) => { SendFeedback("up"); window.Close(); };
        downBtn.Click += (_, __) => { SendFeedback("down"); window.Close(); };

        // Auto-dismiss after 60 seconds if user doesn't interact
        var autoDismiss = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        autoDismiss.Tick += (_, __) => { autoDismiss.Stop(); window.Close(); };

        window.Loaded += (_, __) => { PositionToast(window); autoDismiss.Start(); };
        return window;
    }

    private static Button BuildThumbButton(string emoji, Color bg, Color fg, Color borderColor)
    {
        var btn = new Button
        {
            Width = 38,
            Height = 38,
            Cursor = System.Windows.Input.Cursors.Hand,
            BorderThickness = new Thickness(0)
        };

        var template = new ControlTemplate(typeof(Button));
        var borderFactory = new FrameworkElementFactory(typeof(Border));
        borderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(bg));
        borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
        borderFactory.SetValue(Border.BorderBrushProperty, new SolidColorBrush(borderColor));
        borderFactory.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        var contentFactory = new FrameworkElementFactory(typeof(ContentPresenter));
        contentFactory.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        contentFactory.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        borderFactory.AppendChild(contentFactory);
        template.VisualTree = borderFactory;
        btn.Template = template;

        btn.Content = new TextBlock
        {
            Text = emoji,
            FontSize = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };

        return btn;
    }

    private static void PositionToast(Window window)
    {
        var work = SystemParameters.WorkArea;
        window.Left = work.Left + (work.Width - window.Width) / 2;
        window.Top = work.Top + (work.Height - window.Height) / 2;
    }

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
        catch { /* ignore */ }
    }

    private delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint idEventThread, uint dwmsEventTime);

    private static int CloseCurrentTab(string? hwndStr)
    {
        IntPtr targetHwnd = IntPtr.Zero;
        if (!string.IsNullOrWhiteSpace(hwndStr) && long.TryParse(hwndStr, out var hwndVal) && hwndVal != 0)
        {
            targetHwnd = new IntPtr(hwndVal);
        }

        // ── Strategy 1: UI Automation — find the active tab's close button and click it.
        //    Does NOT require foreground focus. Works from a background process.
        if (targetHwnd != IntPtr.Zero)
        {
            var uiaResult = CloseActiveTabViaUia(targetHwnd);
            if (uiaResult == 0) return 0;
        }

        // ── Strategy 2: Keyboard simulation (Ctrl+W) — requires focus, less reliable.
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

    /// <summary>
    /// Close the active tab via Windows UI Automation. No foreground focus needed.
    /// Strategy A: find close button → InvokePattern.
    /// Strategy B: simulate click at close-button position.
    /// </summary>
    private static int CloseActiveTabViaUia(IntPtr hwnd)
    {
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) return 2;

            // Find the selected TabItem
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
                catch { /* skip */ }
            }
            if (activeTab == null) return 2;

            // Strategy A: Find a close button (search Descendants, not just Children)
            var btnCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            var buttons = activeTab.FindAll(TreeScope.Descendants, btnCond);

            // First pass: named close button (EN: "Close", "Close tab"; DE: "Schließen", "Tab schließen")
            for (int i = 0; i < buttons.Count; i++)
            {
                var name = (buttons[i].Current.Name ?? "").ToLowerInvariant();
                if (name.Contains("close") || name.Contains("schlie"))
                {
                    if (TryInvoke(buttons[i])) return 0;
                }
            }

            // Second pass: any invocable button (Chrome tabs typically have exactly one)
            for (int i = 0; i < buttons.Count; i++)
            {
                if (TryInvoke(buttons[i])) return 0;
            }

            // Strategy B: click at the close-button screen position
            var rect = activeTab.Current.BoundingRectangle;
            if (rect.IsEmpty || rect.Width < 20) return 2;

            // Close button is ~16px from right edge, vertically centered.
            // BoundingRectangle is already in screen coordinates (DPI-scaled).
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
            // Save current clipboard content so we can restore it after pasting the URL
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

                // Verify focus landed on the target window
                var fg = GetForegroundWindow();
                if (fg != hwnd)
                {
                    SetForegroundWindow(hwnd);
                    Thread.Sleep(250);
                }
            }

            // Ctrl+L = focus address bar (works in Chrome, Edge, Firefox, Brave, Opera)
            SendKeyCombo(VK_CONTROL, VK_L);
            Thread.Sleep(250);

            // Ctrl+A = select all (clear any existing URL text)
            SendKeyCombo(VK_CONTROL, VK_A);
            Thread.Sleep(100);

            // Ctrl+V = paste URL from clipboard
            SendKeyCombo(VK_CONTROL, VK_V);
            Thread.Sleep(150);

            // Enter = navigate
            SendSingleKey(VK_RETURN);

            if (attached)
            {
                Thread.Sleep(50);
                AttachThreadInput(currentThreadId, targetThreadId, false);
            }

            // Restore previous clipboard content
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

            // Pump messages so hooks and timer fire.
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

            // First pass: look for the named address bar control
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

            // Fallback: try all Edit controls for a URL-like value
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
        catch
        {
            // ignore
        }
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
