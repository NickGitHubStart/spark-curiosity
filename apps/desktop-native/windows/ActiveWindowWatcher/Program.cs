using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Windows.Interop;
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
            if (args.Length > 1)
            {
                if (args[1].Equals("--watch", StringComparison.OrdinalIgnoreCase))
                    return WatchForeground();
                if (args[1].Equals("--close-tab", StringComparison.OrdinalIgnoreCase))
                    return CloseCurrentTab(args.Length > 2 ? args[2] : null);
                if (args[1].Equals("--close-window", StringComparison.OrdinalIgnoreCase))
                    return CloseWindow(args.Length > 2 ? args[2] : null);
                if (args[1].Equals("--navigate-tab", StringComparison.OrdinalIgnoreCase))
                {
                    var hwndArg = args.Length > 2 ? args[2] : null;
                    var urlArg = args.Length > 3 ? args[3] : null;
                    return NavigateCurrentTab(hwndArg, urlArg);
                }
                if (args[1].Equals("--overlay", StringComparison.OrdinalIgnoreCase))
                    return RunOverlay();
                if (args[1].Equals("--quote", StringComparison.OrdinalIgnoreCase))
                {
                    var text = args.Length > 2 ? args[2] : "";
                    var author = ExtractArg(args, "--author");
                    return RunQuoteToast(text, author);
                }
                if (args[1].Equals("--prompt", StringComparison.OrdinalIgnoreCase))
                {
                    var question = args.Length > 2 ? args[2] : "";
                    return RunPromptDialog(question);
                }
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

    private static string ResolveIconPath()
    {
        var env = Environment.GetEnvironmentVariable("SPARK_ICON_PATH");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(env)) return env;
        return "";
    }

    private static BitmapSource? LoadIconImageCropped()
    {
        try
        {
            var path = ResolveIconPath();
            if (string.IsNullOrWhiteSpace(path)) return null;
            var img = new BitmapImage();
            img.BeginInit();
            img.UriSource = new Uri(path);
            img.CacheOption = BitmapCacheOption.OnLoad;
            img.EndInit();
            var size = Math.Min(img.PixelWidth, img.PixelHeight);
            if (size <= 0) return img;
            var x = Math.Max(0, (img.PixelWidth - size) / 2);
            var y = Math.Max(0, (img.PixelHeight - size) / 2);
            var rect = new Int32Rect(x, y, size, size);
            var square = new CroppedBitmap(img, rect);

            // Render true circular crop (transparent background), so the icon is consistent
            // regardless of where it's reused or how it's rendered.
            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                var brush = new ImageBrush(square) { Stretch = Stretch.UniformToFill };
                dc.DrawEllipse(brush, null, new Point(size / 2.0, size / 2.0), size / 2.0, size / 2.0);
            }
            var rtb = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(dv);
            rtb.Freeze();
            return rtb;
        }
        catch { return null; }
    }

    private static int RunOverlay()
    {
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
        const int IconSize = 72;
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
        var card = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(248, 250, 252)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(229, 231, 235)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18)
        };
        root.Children.Add(card);
        window.Content = root;

        var container = new Grid();
        card.Child = container;

        var collapsed = new Grid { Visibility = Visibility.Visible };
        var expanded = new Grid { Visibility = Visibility.Collapsed };
        container.Children.Add(collapsed);
        container.Children.Add(expanded);

        var iconImg = new Image
        {
            Stretch = Stretch.UniformToFill,
            Width = IconSize,
            Height = IconSize
        };
        var icon = LoadIconImageCropped();
        if (icon != null) iconImg.Source = icon;
        var radius = IconSize / 2.0;
        iconImg.Clip = new EllipseGeometry(new Point(radius, radius), radius, radius);
        iconImg.RenderTransform = new ScaleTransform(2.0, 2.0, radius, radius);

        var iconButton = new Button
        {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Content = iconImg
        };
        collapsed.Children.Add(iconButton);

        expanded.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        expanded.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        expanded.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var header = new DockPanel { Margin = new Thickness(12, 10, 12, 8) };
        var headerIcon = new Image
        {
            Width = 26,
            Height = 26,
            Stretch = Stretch.UniformToFill,
            Source = icon
        };
        if (headerIcon.Source != null)
        {
            headerIcon.Clip = new EllipseGeometry(new Point(13, 13), 13, 13);
        }
        DockPanel.SetDock(headerIcon, Dock.Left);
        header.Children.Add(headerIcon);
        var title = new TextBlock
        {
            Text = "Spark Curiosity",
            Foreground = new SolidColorBrush(Color.FromRgb(17, 24, 39)),
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(8, 4, 0, 0)
        };
        header.Children.Add(title);
        var closeBtn = new Button
        {
            Content = "×",
            Foreground = new SolidColorBrush(Color.FromRgb(107, 114, 128)),
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Width = 24,
            Height = 24,
            HorizontalAlignment = HorizontalAlignment.Right
        };
        DockPanel.SetDock(closeBtn, Dock.Right);
        header.Children.Add(closeBtn);
        expanded.Children.Add(header);
        Grid.SetRow(header, 0);

        var scroll = new ScrollViewer { Margin = new Thickness(12, 0, 12, 8), VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var messages = new StackPanel();
        scroll.Content = messages;
        expanded.Children.Add(scroll);
        Grid.SetRow(scroll, 1);

        var composer = new Grid { Margin = new Thickness(12, 0, 12, 12) };
        var inputWrap = new Border
        {
            CornerRadius = new CornerRadius(12),
            Background = Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromRgb(229, 231, 235)),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8)
        };
        composer.Children.Add(inputWrap);
        var inputGrid = new Grid();
        inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inputWrap.Child = inputGrid;

        var placeholder = new TextBlock
        {
            Text = "Nachricht... (Ctrl+Enter sendet)",
            Foreground = new SolidColorBrush(Color.FromRgb(156, 163, 175)),
            Margin = new Thickness(2, 2, 2, 0),
            IsHitTestVisible = false
        };
        inputGrid.Children.Add(placeholder);
        Grid.SetColumn(placeholder, 0);

        var input = new TextBox
        {
            Background = Brushes.Transparent,
            Foreground = new SolidColorBrush(Color.FromRgb(17, 24, 39)),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(2, 0, 2, 0),
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MaxHeight = 200,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        inputGrid.Children.Add(input);
        Grid.SetColumn(input, 0);

        var actionWrap = new Border
        {
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(Color.FromRgb(243, 244, 246)),
            BorderThickness = new Thickness(1),
            BorderBrush = new SolidColorBrush(Color.FromRgb(229, 231, 235)),
            Margin = new Thickness(8, 0, 0, 0)
        };
        var actionBtn = new Button
        {
            Content = "🎤",
            Width = 32,
            Height = 32,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Foreground = new SolidColorBrush(Color.FromRgb(107, 114, 128))
        };
        actionWrap.Child = actionBtn;
        inputGrid.Children.Add(actionWrap);
        Grid.SetColumn(actionWrap, 1);
        expanded.Children.Add(composer);
        Grid.SetRow(composer, 2);

        void AddMsg(string role, string text, bool isUser)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            var bubble = new Border
            {
                Background = new SolidColorBrush(isUser ? Color.FromRgb(229, 231, 235) : Color.FromRgb(243, 244, 246)),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 8),
                HorizontalAlignment = isUser ? HorizontalAlignment.Left : HorizontalAlignment.Right,
                MaxWidth = 500
            };
            var textBlock = new TextBlock
            {
                Text = text,
                Foreground = new SolidColorBrush(Color.FromRgb(17, 24, 39)),
                TextWrapping = TextWrapping.Wrap,
                FontSize = 12
            };
            bubble.Child = textBlock;
            messages.Children.Add(bubble);
            scroll.ScrollToEnd();
        }

        async void SendMessage()
        {
            var text = input.Text.Trim();
            if (string.IsNullOrWhiteSpace(text)) return;
            input.Text = "";
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
                input.Focus();
            }
            else
            {
                window.Width = IconSize;
                window.Height = IconSize;
            }
            PositionWindow(window, expandedState);
        }

        iconButton.Click += (_, __) => SetExpanded(true);
        closeBtn.Click += (_, __) => SetExpanded(false);
        bool dictating = false;
        bool transcribing = false;
        bool recording = false;
        WaveInEvent? waveIn = null;
        MemoryStream? audioBuffer = null;
        var dictationTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(140) };
        var waveFrames = new[] { "● REC", "●  REC", "●   REC", "●  REC" };
        var transcribeFrames = new[] { "⏳", "⏳.", "⏳..", "⏳..." };
        var frameIdx = 0;
        dictationTimer.Tick += (_, __) =>
        {
            if (transcribing)
            {
                actionBtn.Content = transcribeFrames[frameIdx % transcribeFrames.Length];
            }
            else if (dictating)
            {
                actionBtn.Content = waveFrames[frameIdx % waveFrames.Length];
                actionBtn.Foreground = new SolidColorBrush(Color.FromRgb(220, 38, 38));
            }
            frameIdx += 1;
        };

        void StopDictationUi()
        {
            dictating = false;
            transcribing = false;
            dictationTimer.Stop();
            actionBtn.Foreground = new SolidColorBrush(Color.FromRgb(107, 114, 128));
            UpdateActionState();
        }

        void StartDictationUi()
        {
            dictating = true;
            transcribing = false;
            frameIdx = 0;
            actionBtn.Foreground = new SolidColorBrush(Color.FromRgb(220, 38, 38));
            dictationTimer.Start();
        }

        void ShowTranscribingUi()
        {
            dictating = false;
            transcribing = true;
            frameIdx = 0;
            actionBtn.Foreground = new SolidColorBrush(Color.FromRgb(107, 114, 128));
            actionBtn.Content = "⏳";
        }

        void StartRecording()
        {
            if (recording) return;
            recording = true;
            audioBuffer = new MemoryStream();
            try
            {
                waveIn = new WaveInEvent
                {
                    WaveFormat = new WaveFormat(16000, 16, 1),
                    BufferMilliseconds = 100
                };
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
            waveIn.DataAvailable += (_, e) =>
            {
                audioBuffer?.Write(e.Buffer, 0, e.BytesRecorded);
            };
            waveIn.RecordingStopped += async (_, __) =>
            {
                waveIn?.Dispose();
                waveIn = null;
                recording = false;
                var data = audioBuffer?.ToArray() ?? Array.Empty<byte>();
                audioBuffer = null;

                if (data.Length < 16000)
                {
                    input.Dispatcher.Invoke(() =>
                    {
                        AddMsg("System", "Zu kurz – bitte mind. 0,5 Sek. sprechen.", false);
                        StopDictationUi();
                    });
                    return;
                }

                input.Dispatcher.Invoke(() => ShowTranscribingUi());

                try
                {
                    using var http = new HttpClient();
                    http.Timeout = TimeSpan.FromSeconds(30);
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
                        var transcript = textEl.GetString() ?? "";
                        input.Dispatcher.Invoke(() =>
                        {
                            if (!string.IsNullOrWhiteSpace(transcript))
                            {
                                input.Text = transcript;
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
            };
            waveIn.StartRecording();
        }

        void StopRecording()
        {
            if (!recording) return;
            waveIn?.StopRecording();
        }

        void UpdateActionState()
        {
            var hasText = !string.IsNullOrWhiteSpace(input.Text);
            if (dictating || transcribing) return;
            actionBtn.Content = hasText ? "➤" : "🎤";
            placeholder.Visibility = (hasText || input.IsFocused) ? Visibility.Collapsed : Visibility.Visible;
        }

        actionBtn.Click += (_, __) =>
        {
            if (transcribing) return;
            if (string.IsNullOrWhiteSpace(input.Text))
            {
                input.Focus();
                if (recording)
                {
                    StopRecording();
                    return;
                }
                StartDictationUi();
                StartRecording();
            }
            else
            {
                SendMessage();
            }
        };
        input.KeyDown += (s, e) =>
        {
            if (e.Key == System.Windows.Input.Key.Enter &&
                (System.Windows.Input.Keyboard.Modifiers & System.Windows.Input.ModifierKeys.Control) != 0)
            {
                e.Handled = true;
                SendMessage();
            }
        };
        input.GotFocus += (_, __) =>
        {
            UpdateActionState();
        };
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

        window.Loaded += (_, __) =>
        {
            PositionWindow(window, false);
            UpdateActionState();
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
            var app = new Application();
            var window = BuildQuoteToast(text, author);
            app.Run(window);
            return 0;
        }
        catch { return 1; }
    }

    private static int RunPromptDialog(string question)
    {
        try
        {
            HideConsoleWindow();
            var app = new Application();
            var window = BuildPromptDialog(question);
            app.Run(window);
            return 0;
        }
        catch { return 1; }
    }

    private static Window BuildPromptDialog(string question)
    {
        var q = (question ?? "").Trim();
        var window = new Window
        {
            Width = 380,
            Height = 220,
            Topmost = true,
            WindowStyle = WindowStyle.None,
            ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false,
            AllowsTransparency = true,
            Background = Brushes.Transparent
        };

        var root = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(15, 23, 42)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(31, 41, 55)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(14),
            Padding = new Thickness(12)
        };
        var stack = new StackPanel();
        var questionBlock = new TextBlock
        {
            Text = q,
            Foreground = Brushes.White,
            TextWrapping = TextWrapping.Wrap,
            FontSize = 13,
            Margin = new Thickness(0, 0, 0, 8)
        };
        var input = new TextBox
        {
            Height = 32,
            Background = new SolidColorBrush(Color.FromRgb(11, 18, 32)),
            Foreground = Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromRgb(31, 41, 55)),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 6, 8, 6),
            Margin = new Thickness(0, 0, 0, 10)
        };
        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var cancelBtn = new Button { Content = "Schliessen", Height = 30, Margin = new Thickness(0, 0, 8, 0) };
        var sendBtn = new Button { Content = "Senden", Height = 30 };
        btnRow.Children.Add(cancelBtn);
        btnRow.Children.Add(sendBtn);
        stack.Children.Add(questionBlock);
        stack.Children.Add(input);
        stack.Children.Add(btnRow);
        root.Child = stack;
        window.Content = root;

        async void SendAnswer()
        {
            var answer = input.Text.Trim();
            if (string.IsNullOrWhiteSpace(answer)) { window.Close(); return; }
            try
            {
                using var http = new HttpClient();
                var message = $"Agenten-Frage: {q}\nAntwort: {answer}";
                var payload = JsonSerializer.Serialize(new { message, timestamp = DateTime.UtcNow.ToString("o") });
                await http.PostAsync($"{CompanionBaseUrl()}/chat", new StringContent(payload, Encoding.UTF8, "application/json"));
            }
            catch { /* ignore */ }
            window.Close();
        }

        sendBtn.Click += (_, __) => SendAnswer();
        cancelBtn.Click += (_, __) => window.Close();
        input.KeyDown += (s, e) =>
        {
            if (e.Key == System.Windows.Input.Key.Enter)
            {
                e.Handled = true;
                SendAnswer();
            }
        };

        window.Loaded += (_, __) => PositionToast(window);
        return window;
    }

    private static Window BuildQuoteToast(string text, string author)
    {
        var safeText = (text ?? "").Trim();
        var safeAuthor = (author ?? "").Trim();
        var window = new Window
        {
            Width = 340,
            Height = 190,
            Topmost = true,
            WindowStyle = WindowStyle.None,
            ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false,
            AllowsTransparency = true,
            Background = Brushes.Transparent
        };

        var root = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(15, 23, 42)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(31, 41, 55)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(14),
            Padding = new Thickness(12)
        };
        var stack = new StackPanel();
        var quote = new TextBlock
        {
            Text = $"\"{safeText}\"",
            Foreground = Brushes.White,
            TextWrapping = TextWrapping.Wrap,
            FontSize = 14,
            Margin = new Thickness(0, 0, 0, 6)
        };
        var authorBlock = new TextBlock
        {
            Text = string.IsNullOrWhiteSpace(safeAuthor) ? "" : $"— {safeAuthor}",
            Foreground = Brushes.Gray,
            FontSize = 12,
            Margin = new Thickness(0, 0, 0, 10)
        };
        var btnRow = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var upBtn = new Button { Content = "👍", Width = 40, Height = 32, Margin = new Thickness(0, 0, 8, 0) };
        var downBtn = new Button { Content = "👎", Width = 40, Height = 32 };
        btnRow.Children.Add(upBtn);
        btnRow.Children.Add(downBtn);
        stack.Children.Add(quote);
        stack.Children.Add(authorBlock);
        stack.Children.Add(btnRow);
        root.Child = stack;
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

        window.Loaded += (_, __) => PositionToast(window);
        return window;
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
