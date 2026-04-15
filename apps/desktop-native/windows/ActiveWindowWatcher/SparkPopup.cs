using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;

internal sealed class SparkPopup : Window
{
    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    private static string CompanionBaseUrl() =>
        Environment.GetEnvironmentVariable("SPARK_COMPANION_URL")?.Trim().TrimEnd('/') ?? "http://127.0.0.1:4343";

    // ── Theme tokens (swapped by toggle) ───────────────────────────────────
    private static class Dark
    {
        public static readonly Color Bg       = Color.FromArgb(250, 10, 14, 28);
        public static readonly Color Header   = Color.FromArgb(255, 6, 9, 20);
        public static readonly Color Context  = Color.FromArgb(100, 12, 20, 40);
        public static readonly Color Border   = Color.FromRgb(35, 48, 72);
        public static readonly Color Text     = Color.FromRgb(229, 231, 235);
        public static readonly Color Muted    = Color.FromRgb(120, 138, 165);
        public static readonly Color InputBg  = Color.FromRgb(6, 10, 22);
        public static readonly Color User     = Color.FromRgb(18, 30, 58);
        public static readonly Color Spark    = Color.FromRgb(12, 20, 38);
        public static readonly Color CtxText  = Color.FromRgb(155, 178, 220);
    }

    private static class Light
    {
        public static readonly Color Bg       = Color.FromArgb(250, 248, 249, 252);
        public static readonly Color Header   = Color.FromArgb(255, 240, 242, 248);
        public static readonly Color Context  = Color.FromArgb(100, 225, 230, 242);
        public static readonly Color Border   = Color.FromRgb(210, 215, 225);
        public static readonly Color Text     = Color.FromRgb(28, 32, 42);
        public static readonly Color Muted    = Color.FromRgb(110, 118, 135);
        public static readonly Color InputBg  = Color.FromRgb(255, 255, 255);
        public static readonly Color User     = Color.FromRgb(220, 232, 252);
        public static readonly Color Spark    = Color.FromRgb(235, 242, 255);
        public static readonly Color CtxText  = Color.FromRgb(60, 80, 120);
    }

    private static readonly Color AccentGreen = Color.FromRgb(52, 211, 153);
    private static readonly Color AccentBlue  = Color.FromRgb(96, 165, 250);

    // ── State ──────────────────────────────────────────────────────────────
    private readonly string _selectedText;
    private readonly StackPanel _chatStack;
    private readonly ScrollViewer _chatScroll;
    private readonly TextBox _inputBox;
    private readonly Button _btnCompress;
    private readonly Button _btnSave;
    private readonly Button _themeToggle;
    private readonly Border _card;
    private readonly Border _headerBorder;
    private readonly Border _contextBorder;
    private readonly TextBlock _title;
    private readonly TextBox _contextBox;
    private readonly Border _inputWrap;
    private readonly Button _btnSend;
    private readonly TextBlock _contextLabel;
    private Border? _loadingBubble;
    private string? _compressed;
    private string? _compressedModel;
    private bool _isDark = true;

    public SparkPopup(string selectedText, bool autoCompress = false)
    {
        _selectedText = (selectedText ?? "").Trim();

        var work = SystemParameters.WorkArea;
        Width  = work.Width  * 0.8;
        Height = work.Height * 0.8;
        Topmost = true;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        SourceInitialized += (_, __) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW);
        };

        // ── Root card ───────────────────────────────────────────────────
        _card = new Border
        {
            CornerRadius = new CornerRadius(18),
            Effect = new DropShadowEffect
            {
                Color = Colors.Black, BlurRadius = 60,
                ShadowDepth = 24, Opacity = 0.75, Direction = 270
            }
        };

        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // header
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // context
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // actions
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // chat
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // input
        _card.Child = rootGrid;

        // ── Header ──────────────────────────────────────────────────────
        _headerBorder = new Border
        {
            CornerRadius = new CornerRadius(18, 18, 0, 0),
            Padding = new Thickness(22, 15, 14, 15)
        };
        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _title = new TextBlock
        {
            Text = "✨  Sparky",
            FontSize = 15, FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(_title, 0);

        _themeToggle = MakeIconBtn("☀", Dark.Muted);
        _themeToggle.ToolTip = "Dark / Light";
        _themeToggle.Click += (_, __) => { _isDark = !_isDark; ApplyTheme(); };
        Grid.SetColumn(_themeToggle, 1);

        var btnClose = MakeIconBtn("✕", Dark.Muted);
        btnClose.Click += (_, __) => Close();
        Grid.SetColumn(btnClose, 2);

        headerGrid.Children.Add(_title);
        headerGrid.Children.Add(_themeToggle);
        headerGrid.Children.Add(btnClose);
        _headerBorder.Child = headerGrid;
        Grid.SetRow(_headerBorder, 0);
        rootGrid.Children.Add(_headerBorder);

        // ── Context strip ───────────────────────────────────────────────
        var contextPreview = _selectedText.Length > 320
            ? _selectedText.Substring(0, 320) + "…"
            : _selectedText;

        _contextBorder = new Border
        {
            Padding = new Thickness(22, 12, 22, 12)
        };
        var contextStack = new StackPanel();
        _contextLabel = new TextBlock
        {
            Text = "📋  Markierter Text",
            FontSize = 10,
            Margin = new Thickness(0, 0, 0, 5)
        };
        contextStack.Children.Add(_contextLabel);

        _contextBox = new TextBox
        {
            Text = contextPreview,
            IsReadOnly = true,
            TextWrapping = TextWrapping.Wrap,
            MaxHeight = 120,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            FontSize = 12,
            Padding = new Thickness(0),
            IsTabStop = false
        };
        contextStack.Children.Add(_contextBox);
        _contextBorder.Child = contextStack;
        Grid.SetRow(_contextBorder, 1);
        rootGrid.Children.Add(_contextBorder);

        // ── Action buttons ──────────────────────────────────────────────
        var actionsRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(22, 13, 22, 2)
        };
        _btnCompress = MakeActionBtn("⚡  Komprimieren", AccentGreen);
        _btnCompress.Click += async (_, __) => await CompressAsync();
        actionsRow.Children.Add(_btnCompress);

        _btnSave = MakeActionBtn("🧠  In Brain speichern", AccentBlue);
        _btnSave.Visibility = Visibility.Collapsed;
        _btnSave.Click += async (_, __) => await SaveToBrainAsync();
        actionsRow.Children.Add(_btnSave);
        Grid.SetRow(actionsRow, 2);
        rootGrid.Children.Add(actionsRow);

        // ── Chat area ───────────────────────────────────────────────────
        _chatStack = new StackPanel { Margin = new Thickness(0) };
        _chatScroll = new ScrollViewer
        {
            Content = _chatStack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Margin = new Thickness(18, 10, 18, 0)
        };
        Grid.SetRow(_chatScroll, 3);
        rootGrid.Children.Add(_chatScroll);

        // ── Input bar ───────────────────────────────────────────────────
        _inputWrap = new Border
        {
            Padding = new Thickness(16, 12, 16, 16),
            Margin = new Thickness(0)
        };
        var inputGrid = new Grid();
        inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _inputBox = new TextBox
        {
            AcceptsReturn = false,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 42,
            MaxHeight = 120,
            Padding = new Thickness(14, 11, 14, 11),
            FontSize = 14,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Text = "Frage an Sparky …"
        };
        _inputBox.GotFocus += (_, __) =>
        {
            if (_inputBox.Text == "Frage an Sparky …")
            {
                _inputBox.Text = "";
                _inputBox.Foreground = new SolidColorBrush(_isDark ? Dark.Text : Light.Text);
            }
        };
        _inputBox.LostFocus += (_, __) =>
        {
            if (string.IsNullOrWhiteSpace(_inputBox.Text))
            {
                _inputBox.Text = "Frage an Sparky …";
                _inputBox.Foreground = new SolidColorBrush(_isDark ? Dark.Muted : Light.Muted);
            }
        };

        _btnSend = new Button
        {
            Content = "→",
            FontSize = 22,
            Width = 48, Height = 42,
            Margin = new Thickness(10, 0, 0, 0),
            Background = new SolidColorBrush(AccentBlue),
            Foreground = new SolidColorBrush(Color.FromRgb(6, 10, 20)),
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            FontWeight = FontWeights.Bold,
            VerticalContentAlignment = VerticalAlignment.Center
        };
        _btnSend.Click += async (_, __) => await SendMessageAsync();
        _inputBox.KeyDown += async (_, e) =>
        {
            if (e.Key == Key.Enter && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
            {
                e.Handled = true;
                await SendMessageAsync();
            }
        };

        Grid.SetColumn(_inputBox, 0);
        Grid.SetColumn(_btnSend, 1);
        inputGrid.Children.Add(_inputBox);
        inputGrid.Children.Add(_btnSend);
        _inputWrap.Child = inputGrid;
        Grid.SetRow(_inputWrap, 4);
        rootGrid.Children.Add(_inputWrap);

        Content = _card;

        KeyDown += (_, e) => { if (e.Key == Key.Escape) Close(); };
        Loaded += async (_, __) =>
        {
            ApplyTheme();
            _inputBox.Focus();
            if (autoCompress) await CompressAsync();
        };
    }

    // ── Theme application ──────────────────────────────────────────────────
    private void ApplyTheme()
    {
        var t = _isDark ? (dynamic)new { Dark.Bg, Dark.Header, Dark.Context, Dark.Border,
            Dark.Text, Dark.Muted, Dark.InputBg, Dark.CtxText }
            : new { Light.Bg, Light.Header, Light.Context, Light.Border,
            Light.Text, Light.Muted, Light.InputBg, Light.CtxText };

        Color bg      = _isDark ? Dark.Bg      : Light.Bg;
        Color header  = _isDark ? Dark.Header   : Light.Header;
        Color context = _isDark ? Dark.Context  : Light.Context;
        Color border  = _isDark ? Dark.Border   : Light.Border;
        Color text    = _isDark ? Dark.Text     : Light.Text;
        Color muted   = _isDark ? Dark.Muted    : Light.Muted;
        Color inputBg = _isDark ? Dark.InputBg  : Light.InputBg;
        Color ctxText = _isDark ? Dark.CtxText  : Light.CtxText;

        _card.Background      = new SolidColorBrush(bg);
        _card.BorderBrush     = new SolidColorBrush(border);
        _card.BorderThickness = new Thickness(1);

        _headerBorder.Background = new SolidColorBrush(header);
        _title.Foreground        = new SolidColorBrush(text);
        _themeToggle.Content     = _isDark ? "☀" : "🌙";
        _themeToggle.Foreground  = new SolidColorBrush(muted);

        _contextBorder.Background      = new SolidColorBrush(context);
        _contextBorder.BorderBrush     = new SolidColorBrush(border);
        _contextBorder.BorderThickness = new Thickness(0, 1, 0, 1);
        _contextLabel.Foreground       = new SolidColorBrush(muted);
        _contextBox.Foreground         = new SolidColorBrush(ctxText);

        _inputBox.Background  = new SolidColorBrush(inputBg);
        _inputBox.Foreground  = new SolidColorBrush(_inputBox.Text == "Frage an Sparky …" ? muted : text);
        _inputBox.CaretBrush  = new SolidColorBrush(text);
        _inputBox.BorderBrush = new SolidColorBrush(border);
        _inputBox.BorderThickness = new Thickness(1);

        _inputWrap.BorderBrush     = new SolidColorBrush(border);
        _inputWrap.BorderThickness = new Thickness(0, 1, 0, 0);

        // Re-color existing bubbles
        foreach (var child in _chatStack.Children)
        {
            if (child is Border b && b.Child is TextBlock tb)
            {
                bool isUser = b.HorizontalAlignment == HorizontalAlignment.Right;
                if (isUser)
                {
                    b.Background  = new SolidColorBrush(_isDark ? Dark.User : Light.User);
                    b.BorderBrush = new SolidColorBrush(border);
                    tb.Foreground = new SolidColorBrush(text);
                }
                else
                {
                    b.Background  = new SolidColorBrush(_isDark ? Dark.Spark : Light.Spark);
                    b.BorderBrush = new SolidColorBrush(border);
                    tb.Foreground = new SolidColorBrush(tb.FontStyle == FontStyles.Italic ? muted : text);
                }
            }
        }
    }

    // ── Compress ───────────────────────────────────────────────────────────
    private async Task CompressAsync()
    {
        _btnCompress.IsEnabled = false;
        _btnCompress.Content   = "Komprimiere …";
        AddSparkBubble("Komprimiere deinen Text …", loading: true);
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var res  = await http.PostAsync(
                $"{CompanionBaseUrl()}/brain/compress-preview",
                Json(new { content = _selectedText }));
            var body = await res.Content.ReadAsStringAsync();
            RemoveLoading();

            if (!res.IsSuccessStatusCode) { AddSparkBubble("Komprimierung fehlgeschlagen."); return; }

            using var doc = JsonDocument.Parse(body);
            _compressed      = doc.RootElement.TryGetProperty("content", out var c) ? c.GetString() : "";
            _compressedModel = doc.RootElement.TryGetProperty("model",   out var m) ? m.GetString() : "";

            var modelNote = string.IsNullOrWhiteSpace(_compressedModel) ? "" : $"  [{_compressedModel}]";
            AddSparkBubble($"Komprimiert:{modelNote}\n\n{_compressed}");
            _btnSave.Visibility = Visibility.Visible;
        }
        catch (Exception ex) { RemoveLoading(); AddSparkBubble($"Fehler: {ex.Message}"); }
        finally
        {
            _btnCompress.Content   = "⚡  Komprimieren";
            _btnCompress.IsEnabled = true;
        }
    }

    // ── Save ───────────────────────────────────────────────────────────────
    private async Task SaveToBrainAsync()
    {
        if (string.IsNullOrWhiteSpace(_compressed)) return;
        _btnSave.IsEnabled = false;
        _btnSave.Content   = "Speichere …";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };

            var clsRes  = await http.PostAsync($"{CompanionBaseUrl()}/brain/classify", Json(new { content = _compressed }));
            var clsBody = await clsRes.Content.ReadAsStringAsync();
            string? title = null, type = null, themenpfad = null, parentIndex = null;
            var related = new List<string>();
            if (clsRes.IsSuccessStatusCode)
            {
                using var d = JsonDocument.Parse(clsBody);
                var r = d.RootElement;
                if (r.TryGetProperty("title",         out var ti)) title       = ti.GetString();
                if (r.TryGetProperty("type",          out var ty)) type        = ty.GetString();
                if (r.TryGetProperty("themenpfad",    out var th)) themenpfad  = th.GetString();
                if (r.TryGetProperty("parentIndex",   out var p) && p.ValueKind != JsonValueKind.Null)
                    parentIndex = p.GetString();
                if (r.TryGetProperty("relatedIndices", out var rel) && rel.ValueKind == JsonValueKind.Array)
                    foreach (var x in rel.EnumerateArray())
                    { var s = x.GetString(); if (!string.IsNullOrWhiteSpace(s)) related.Add(s!); }
            }

            var saveRes = await http.PostAsync($"{CompanionBaseUrl()}/brain/save", Json(new
            {
                content  = _compressed,
                title, type, themenpfad, parentIndex,
                relatedIndices = related,
                source         = "spark-popup",
                originalSource = _selectedText.Length > 400 ? _selectedText[..400] : _selectedText,
                aiModel        = _compressedModel
            }));
            var saveBody = await saveRes.Content.ReadAsStringAsync();

            if (saveRes.IsSuccessStatusCode)
            {
                using var d2 = JsonDocument.Parse(saveBody);
                var idx = d2.RootElement.TryGetProperty("index", out var ix) ? ix.GetString() : "";
                AddSparkBubble($"✅  Im Brain gespeichert  ({idx})");
                _btnSave.Content = "✅  Gespeichert";
            }
            else
            {
                AddSparkBubble("Fehler beim Speichern.");
                _btnSave.IsEnabled = true;
                _btnSave.Content   = "🧠  In Brain speichern";
            }
        }
        catch (Exception ex)
        {
            AddSparkBubble($"Fehler: {ex.Message}");
            _btnSave.IsEnabled = true;
            _btnSave.Content   = "🧠  In Brain speichern";
        }
    }

    // ── Chat ───────────────────────────────────────────────────────────────
    private async Task SendMessageAsync()
    {
        var question = _inputBox.Text == "Frage an Sparky …" ? "" : _inputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(question)) return;

        AddUserBubble(question);
        _inputBox.Text       = "Frage an Sparky …";
        _inputBox.Foreground = new SolidColorBrush(_isDark ? Dark.Muted : Light.Muted);
        _btnSend.IsEnabled   = false;
        AddSparkBubble("Denke nach …", loading: true);

        try
        {
            var ctx = _compressed != null
                ? $"Komprimierter Kontext:\n{_compressed}\n\nOriginaltext:\n{_selectedText}"
                : $"Kontext (markierter Text):\n{_selectedText}";

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var res  = await http.PostAsync(
                $"{CompanionBaseUrl()}/chat",
                Json(new { message = $"{ctx}\n\nFrage: {question}" }));
            var body = await res.Content.ReadAsStringAsync();
            RemoveLoading();

            if (!res.IsSuccessStatusCode) { AddSparkBubble("Antwort fehlgeschlagen."); return; }

            using var doc = JsonDocument.Parse(body);
            var reply = doc.RootElement.TryGetProperty("reply", out var rp) ? rp.GetString() ?? "" : "";
            AddSparkBubble(reply);
        }
        catch (Exception ex) { RemoveLoading(); AddSparkBubble($"Fehler: {ex.Message}"); }
        finally
        {
            _btnSend.IsEnabled = true;
            _inputBox.Focus();
        }
    }

    // ── Chat bubble helpers ────────────────────────────────────────────────
    private void AddUserBubble(string text)
    {
        Color userBg = _isDark ? Dark.User : Light.User;
        Color border = _isDark ? Dark.Border : Light.Border;
        Color fg     = _isDark ? Dark.Text : Light.Text;

        var b = new Border
        {
            Background        = new SolidColorBrush(userBg),
            BorderBrush       = new SolidColorBrush(border),
            BorderThickness   = new Thickness(1),
            CornerRadius      = new CornerRadius(12, 12, 3, 12),
            Padding           = new Thickness(13, 9, 13, 9),
            Margin            = new Thickness(60, 4, 0, 4),
            HorizontalAlignment = HorizontalAlignment.Right
        };
        b.Child = new TextBlock
        {
            Text = text,
            Foreground = new SolidColorBrush(fg),
            FontSize = 13, TextWrapping = TextWrapping.Wrap
        };
        _chatStack.Children.Add(b);
        ScrollDown();
    }

    private void AddSparkBubble(string text, bool loading = false)
    {
        Color sparkBg = _isDark ? Dark.Spark : Light.Spark;
        Color border  = _isDark ? Dark.Border : Light.Border;
        Color muted   = _isDark ? Dark.Muted : Light.Muted;
        Color fg      = _isDark ? Dark.Text : Light.Text;

        var b = new Border
        {
            Background      = new SolidColorBrush(sparkBg),
            BorderBrush     = new SolidColorBrush(border),
            BorderThickness = new Thickness(1),
            CornerRadius    = new CornerRadius(3, 12, 12, 12),
            Padding         = new Thickness(13, 9, 13, 9),
            Margin          = new Thickness(0, 4, 60, 4),
            HorizontalAlignment = HorizontalAlignment.Left
        };
        b.Child = new TextBlock
        {
            Text       = text,
            Foreground = new SolidColorBrush(loading ? muted : fg),
            FontSize   = 13,
            FontStyle  = loading ? FontStyles.Italic : FontStyles.Normal,
            TextWrapping = TextWrapping.Wrap
        };
        if (loading) _loadingBubble = b;
        _chatStack.Children.Add(b);
        ScrollDown();
    }

    private void RemoveLoading()
    {
        if (_loadingBubble != null && _chatStack.Children.Contains(_loadingBubble))
            _chatStack.Children.Remove(_loadingBubble);
        _loadingBubble = null;
    }

    private void ScrollDown()
    {
        _chatScroll.UpdateLayout();
        _chatScroll.ScrollToEnd();
    }

    // ── UI helpers ─────────────────────────────────────────────────────────
    private static Button MakeIconBtn(string label, Color fg) => new Button
    {
        Content = label, FontSize = 17,
        Width = 30, Height = 30,
        Background = Brushes.Transparent,
        Foreground = new SolidColorBrush(fg),
        BorderThickness = new Thickness(0),
        Cursor = Cursors.Hand,
        VerticalContentAlignment = VerticalAlignment.Center,
        Padding = new Thickness(0)
    };

    private static Button MakeActionBtn(string label, Color accent) => new Button
    {
        Content = label,
        Padding = new Thickness(15, 8, 15, 8),
        Margin  = new Thickness(0, 0, 10, 0),
        FontSize = 12,
        Background  = new SolidColorBrush(Color.FromArgb(38, accent.R, accent.G, accent.B)),
        Foreground  = new SolidColorBrush(accent),
        BorderBrush = new SolidColorBrush(Color.FromArgb(75, accent.R, accent.G, accent.B)),
        BorderThickness = new Thickness(1),
        Cursor = Cursors.Hand
    };

    private static StringContent Json(object obj) =>
        new StringContent(JsonSerializer.Serialize(obj), Encoding.UTF8, "application/json");
}
