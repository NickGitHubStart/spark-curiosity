using System;
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

    // ── Design tokens ─────────────────────────────────────────────────────
    private static readonly Color BgColor      = Color.FromArgb(242, 8, 12, 26);
    private static readonly Color HeaderBg     = Color.FromArgb(255, 6, 9, 20);
    private static readonly Color ContextBg    = Color.FromArgb(100, 12, 20, 40);
    private static readonly Color BorderCol    = Color.FromRgb(35, 48, 72);
    private static readonly Color TextCol      = Color.FromRgb(229, 231, 235);
    private static readonly Color MutedCol     = Color.FromRgb(120, 138, 165);
    private static readonly Color AccentGreen  = Color.FromRgb(52,  211, 153);
    private static readonly Color AccentBlue   = Color.FromRgb(96,  165, 250);
    private static readonly Color InputBgCol   = Color.FromRgb(6,   10,  22);
    private static readonly Color UserBubble   = Color.FromRgb(18,  30,  58);
    private static readonly Color SparkBubble  = Color.FromRgb(12,  20,  38);

    // ── State ──────────────────────────────────────────────────────────────
    private readonly string _selectedText;
    private readonly StackPanel _chatStack;
    private readonly ScrollViewer _chatScroll;
    private readonly TextBox _inputBox;
    private readonly Button _btnCompress;
    private readonly Button _btnSave;
    private Border? _loadingBubble;
    private string? _compressed;
    private string? _compressedModel;

    public SparkPopup(string selectedText, bool autoCompress = false)
    {
        _selectedText = (selectedText ?? "").Trim();

        Width = 540;
        MaxHeight = 720;
        SizeToContent = SizeToContent.Height;
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

        // ── Root card ─────────────────────────────────────────────────────
        var card = new Border
        {
            Background  = new SolidColorBrush(BgColor),
            BorderBrush = new SolidColorBrush(BorderCol),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Effect = new DropShadowEffect
            {
                Color       = Colors.Black,
                BlurRadius  = 60,
                ShadowDepth = 24,
                Opacity     = 0.75,
                Direction   = 270
            }
        };

        var root = new StackPanel();
        card.Child = root;

        // ── Header ────────────────────────────────────────────────────────
        var header = new Border
        {
            Background    = new SolidColorBrush(HeaderBg),
            CornerRadius  = new CornerRadius(18, 18, 0, 0),
            Padding       = new Thickness(22, 15, 14, 15)
        };
        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock
        {
            Text       = "✨  Sparky",
            Foreground = new SolidColorBrush(TextCol),
            FontSize   = 15,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(title, 0);

        var btnClose = MakeIconBtn("✕", MutedCol);
        btnClose.Click += (_, __) => Close();
        Grid.SetColumn(btnClose, 1);

        headerGrid.Children.Add(title);
        headerGrid.Children.Add(btnClose);
        header.Child = headerGrid;
        root.Children.Add(header);

        // ── Context strip ─────────────────────────────────────────────────
        var contextPreview = _selectedText.Length > 220
            ? _selectedText.Substring(0, 220) + "…"
            : _selectedText;

        var contextBorder = new Border
        {
            Background      = new SolidColorBrush(ContextBg),
            BorderBrush     = new SolidColorBrush(BorderCol),
            BorderThickness = new Thickness(0, 1, 0, 1),
            Padding         = new Thickness(22, 12, 22, 12)
        };
        var contextStack = new StackPanel();
        contextStack.Children.Add(new TextBlock
        {
            Text       = "📋  Kopierter Text",
            Foreground = new SolidColorBrush(MutedCol),
            FontSize   = 10,
            Margin     = new Thickness(0, 0, 0, 5)
        });
        var contextBox = new TextBox
        {
            Text                       = contextPreview,
            IsReadOnly                 = true,
            TextWrapping               = TextWrapping.Wrap,
            MaxHeight                  = 90,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background                 = Brushes.Transparent,
            Foreground                 = new SolidColorBrush(Color.FromRgb(155, 178, 220)),
            BorderThickness            = new Thickness(0),
            FontSize                   = 12,
            Padding                    = new Thickness(0),
            IsTabStop                  = false
        };
        contextStack.Children.Add(contextBox);
        contextBorder.Child = contextStack;
        root.Children.Add(contextBorder);

        // ── Action buttons ────────────────────────────────────────────────
        var actionsRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin      = new Thickness(22, 13, 22, 2)
        };
        _btnCompress = MakeActionBtn("⚡  Komprimieren", AccentGreen);
        _btnCompress.Click += async (_, __) => await CompressAsync();
        actionsRow.Children.Add(_btnCompress);

        _btnSave = MakeActionBtn("🧠  In Brain speichern", AccentBlue);
        _btnSave.Visibility = Visibility.Collapsed;
        _btnSave.Click += async (_, __) => await SaveToBrainAsync();
        actionsRow.Children.Add(_btnSave);
        root.Children.Add(actionsRow);

        // ── Chat area ─────────────────────────────────────────────────────
        _chatStack  = new StackPanel { Margin = new Thickness(0) };
        _chatScroll = new ScrollViewer
        {
            Content                    = _chatStack,
            MaxHeight                  = 300,
            MinHeight                  = 0,
            VerticalScrollBarVisibility   = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Margin                     = new Thickness(18, 10, 18, 0)
        };
        root.Children.Add(_chatScroll);

        // ── Input bar ─────────────────────────────────────────────────────
        var inputWrap = new Border
        {
            BorderBrush     = new SolidColorBrush(BorderCol),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding         = new Thickness(16, 12, 16, 16),
            Margin          = new Thickness(0, 10, 0, 0)
        };
        var inputGrid = new Grid();
        inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _inputBox = new TextBox
        {
            AcceptsReturn              = false,
            TextWrapping               = TextWrapping.Wrap,
            MinHeight                  = 40,
            MaxHeight                  = 90,
            Background                 = new SolidColorBrush(InputBgCol),
            Foreground                 = new SolidColorBrush(MutedCol),
            CaretBrush                 = new SolidColorBrush(TextCol),
            BorderBrush                = new SolidColorBrush(BorderCol),
            BorderThickness            = new Thickness(1),
            Padding                    = new Thickness(12, 10, 12, 10),
            FontSize                   = 13,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Text                       = "Frage an Sparky …"
        };
        _inputBox.GotFocus += (_, __) =>
        {
            if (_inputBox.Text == "Frage an Sparky …")
            {
                _inputBox.Text = "";
                _inputBox.Foreground = new SolidColorBrush(TextCol);
            }
        };
        _inputBox.LostFocus += (_, __) =>
        {
            if (string.IsNullOrWhiteSpace(_inputBox.Text))
            {
                _inputBox.Text = "Frage an Sparky …";
                _inputBox.Foreground = new SolidColorBrush(MutedCol);
            }
        };

        var btnSend = new Button
        {
            Content                  = "→",
            FontSize                 = 20,
            Width                    = 44,
            Height                   = 40,
            Margin                   = new Thickness(10, 0, 0, 0),
            Background               = new SolidColorBrush(AccentBlue),
            Foreground               = new SolidColorBrush(Color.FromRgb(6, 10, 20)),
            BorderThickness          = new Thickness(0),
            Cursor                   = Cursors.Hand,
            FontWeight               = FontWeights.Bold,
            VerticalContentAlignment = VerticalAlignment.Center
        };
        btnSend.Click += async (_, __) => await SendMessageAsync(btnSend);
        _inputBox.KeyDown += async (_, e) =>
        {
            if (e.Key == Key.Enter && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
            {
                e.Handled = true;
                await SendMessageAsync(btnSend);
            }
        };

        Grid.SetColumn(_inputBox, 0);
        Grid.SetColumn(btnSend, 1);
        inputGrid.Children.Add(_inputBox);
        inputGrid.Children.Add(btnSend);
        inputWrap.Child = inputGrid;
        root.Children.Add(inputWrap);

        Content = card;

        KeyDown     += (_, e) => { if (e.Key == Key.Escape) Close(); };
        Loaded      += async (_, __) =>
        {
            _inputBox.Focus();
            if (autoCompress) await CompressAsync();
        };
    }

    // ── Compress ──────────────────────────────────────────────────────────
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

    // ── Save ──────────────────────────────────────────────────────────────
    private async Task SaveToBrainAsync()
    {
        if (string.IsNullOrWhiteSpace(_compressed)) return;
        _btnSave.IsEnabled = false;
        _btnSave.Content   = "Speichere …";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };

            // Classify
            var clsRes  = await http.PostAsync($"{CompanionBaseUrl()}/brain/classify", Json(new { content = _compressed }));
            var clsBody = await clsRes.Content.ReadAsStringAsync();
            string? title = null, type = null, themenpfad = null, parentIndex = null;
            var related = new System.Collections.Generic.List<string>();
            if (clsRes.IsSuccessStatusCode)
            {
                using var d = JsonDocument.Parse(clsBody);
                var r = d.RootElement;
                if (r.TryGetProperty("title",         out var t))  title        = t.GetString();
                if (r.TryGetProperty("type",          out var ty)) type         = ty.GetString();
                if (r.TryGetProperty("themenpfad",    out var th)) themenpfad   = th.GetString();
                if (r.TryGetProperty("parentIndex",   out var p) && p.ValueKind != JsonValueKind.Null)
                    parentIndex = p.GetString();
                if (r.TryGetProperty("relatedIndices", out var rel) && rel.ValueKind == JsonValueKind.Array)
                    foreach (var x in rel.EnumerateArray())
                    { var s = x.GetString(); if (!string.IsNullOrWhiteSpace(s)) related.Add(s!); }
            }

            // Save
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
                using var d2  = JsonDocument.Parse(saveBody);
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

    // ── Chat ──────────────────────────────────────────────────────────────
    private async Task SendMessageAsync(Button btnSend)
    {
        var question = _inputBox.Text == "Frage an Sparky …" ? "" : _inputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(question)) return;

        AddUserBubble(question);
        _inputBox.Text       = "Frage an Sparky …";
        _inputBox.Foreground = new SolidColorBrush(MutedCol);
        btnSend.IsEnabled    = false;
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

            using var doc  = JsonDocument.Parse(body);
            var reply = doc.RootElement.TryGetProperty("reply", out var rp) ? rp.GetString() ?? "" : "";
            AddSparkBubble(reply);
        }
        catch (Exception ex) { RemoveLoading(); AddSparkBubble($"Fehler: {ex.Message}"); }
        finally
        {
            btnSend.IsEnabled = true;
            _inputBox.Focus();
        }
    }

    // ── Chat bubble helpers ───────────────────────────────────────────────
    private void AddUserBubble(string text)
    {
        var b = new Border
        {
            Background        = new SolidColorBrush(UserBubble),
            CornerRadius      = new CornerRadius(12, 12, 3, 12),
            Padding           = new Thickness(13, 9, 13, 9),
            Margin            = new Thickness(60, 4, 0, 4),
            HorizontalAlignment = HorizontalAlignment.Right
        };
        b.Child = new TextBlock
        {
            Text        = text,
            Foreground  = new SolidColorBrush(TextCol),
            FontSize    = 13,
            TextWrapping = TextWrapping.Wrap
        };
        _chatStack.Children.Add(b);
        ScrollDown();
    }

    private void AddSparkBubble(string text, bool loading = false)
    {
        var b = new Border
        {
            Background      = new SolidColorBrush(SparkBubble),
            BorderBrush     = new SolidColorBrush(BorderCol),
            BorderThickness = new Thickness(1),
            CornerRadius    = new CornerRadius(3, 12, 12, 12),
            Padding         = new Thickness(13, 9, 13, 9),
            Margin          = new Thickness(0, 4, 60, 4),
            HorizontalAlignment = HorizontalAlignment.Left
        };
        b.Child = new TextBlock
        {
            Text        = text,
            Foreground  = new SolidColorBrush(loading ? MutedCol : Color.FromRgb(185, 215, 255)),
            FontSize    = 13,
            FontStyle   = loading ? FontStyles.Italic : FontStyles.Normal,
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

    // ── UI helpers ────────────────────────────────────────────────────────
    private static Button MakeIconBtn(string label, Color fg) => new Button
    {
        Content                  = label,
        FontSize                 = 17,
        Width                    = 30,
        Height                   = 30,
        Background               = Brushes.Transparent,
        Foreground               = new SolidColorBrush(fg),
        BorderThickness          = new Thickness(0),
        Cursor                   = Cursors.Hand,
        VerticalContentAlignment = VerticalAlignment.Center,
        Padding                  = new Thickness(0)
    };

    private static Button MakeActionBtn(string label, Color accent) => new Button
    {
        Content         = label,
        Padding         = new Thickness(15, 8, 15, 8),
        Margin          = new Thickness(0, 0, 10, 0),
        FontSize        = 12,
        Background      = new SolidColorBrush(Color.FromArgb(38, accent.R, accent.G, accent.B)),
        Foreground      = new SolidColorBrush(accent),
        BorderBrush     = new SolidColorBrush(Color.FromArgb(75, accent.R, accent.G, accent.B)),
        BorderThickness = new Thickness(1),
        Cursor          = Cursors.Hand
    };

    private static StringContent Json(object obj) =>
        new StringContent(JsonSerializer.Serialize(obj), Encoding.UTF8, "application/json");
}
