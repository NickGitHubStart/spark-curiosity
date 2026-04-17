using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

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

    // ── Theme ──────────────────────────────────────────────────────────────
    private static class Dark
    {
        public static readonly Color Bg       = Color.FromArgb(255, 18, 18, 22);
        public static readonly Color Header   = Color.FromArgb(255, 12, 12, 16);
        public static readonly Color Bubble   = Color.FromRgb(28, 28, 36);
        public static readonly Color UserBubble = Color.FromRgb(38, 42, 62);
        public static readonly Color SparkBubble = Color.FromRgb(24, 26, 38);
        public static readonly Color Border   = Color.FromRgb(45, 45, 60);
        public static readonly Color Text     = Color.FromRgb(230, 230, 238);
        public static readonly Color Muted    = Color.FromRgb(110, 110, 130);
        public static readonly Color InputBg  = Color.FromRgb(24, 24, 30);
        public static readonly Color SendBtn  = Color.FromRgb(230, 230, 238);
        public static readonly Color SendFg   = Color.FromRgb(18, 18, 22);
    }

    private static class Light
    {
        public static readonly Color Bg       = Color.FromArgb(255, 250, 250, 252);
        public static readonly Color Header   = Color.FromArgb(255, 242, 242, 248);
        public static readonly Color Bubble   = Color.FromRgb(255, 255, 255);
        public static readonly Color UserBubble = Color.FromRgb(224, 232, 252);
        public static readonly Color SparkBubble = Color.FromRgb(242, 244, 250);
        public static readonly Color Border   = Color.FromRgb(215, 215, 228);
        public static readonly Color Text     = Color.FromRgb(22, 22, 30);
        public static readonly Color Muted    = Color.FromRgb(120, 120, 140);
        public static readonly Color InputBg  = Color.FromRgb(255, 255, 255);
        public static readonly Color SendBtn  = Color.FromRgb(22, 22, 30);
        public static readonly Color SendFg   = Color.FromRgb(250, 250, 252);
    }

    private static readonly Color AccentGreen  = Color.FromRgb(52, 211, 153);
    private static readonly Color AccentBlue   = Color.FromRgb(96, 165, 250);
    private static readonly FontFamily AppFont = new FontFamily("Segoe UI Variable Display, Segoe UI, sans-serif");

    // ── State ──────────────────────────────────────────────────────────────
    private readonly string _originalText;
    private string? _compressedModel;
    private bool _isDark = true;
    private bool _micTargetIsEdit = true;   // true = mic output -> editBox; false -> inputBox

    // mic
    private WasapiCapture? _wasapiCapture;
    private WaveInEvent? _waveInFallback;
    private MemoryStream? _audioBuffer;
    private bool _micRecording;
    private bool _micTranscribing;
    private readonly DispatcherTimer _micPulseTimer;
    private int _micPulseFrame;
    private static readonly Color DangerRed = Color.FromRgb(239, 68, 68);

    // ── UI refs ────────────────────────────────────────────────────────────
    private readonly Border _card;
    private readonly Border _headerBorder;
    private readonly Border _inputWrap;
    private readonly TextBlock _title;
    private readonly TextBlock _editLabel;
    private readonly TextBox _editBox;
    private readonly Border _editBubble;
    private readonly Button _btnCompress;
    private readonly Button _btnSave;
    private readonly Button _themeToggle;
    private readonly StackPanel _contentStack;
    private readonly ScrollViewer _mainScroll;
    private readonly TextBox _inputBox;
    private readonly Button _btnSend;
    private readonly Button _btnMic;
    private Border? _loadingBubble;
    private readonly Border _actionsRow;

    public SparkPopup(string selectedText, bool autoCompress = false)
    {
        _originalText = (selectedText ?? "").Trim();

        var work = SystemParameters.WorkArea;
        Width  = work.Width  * 0.8;
        Height = work.Height * 0.8;
        Topmost = true;
        WindowStyle = WindowStyle.None;
        ResizeMode  = ResizeMode.NoResize;
        ShowInTaskbar = false;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        SourceInitialized += (_, __) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            SetWindowLong(hwnd, GWL_EXSTYLE, GetWindowLong(hwnd, GWL_EXSTYLE) | WS_EX_TOOLWINDOW);
        };

        // ── Root card ──────────────────────────────────────────────────────
        _card = new Border
        {
            CornerRadius = new CornerRadius(18),
            Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 50, ShadowDepth = 20, Opacity = 0.7, Direction = 270 }
        };

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });                          // 0: header
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });    // 1: scroll
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });                          // 2: input bar
        _card.Child = root;

        // ── Header ─────────────────────────────────────────────────────────
        _headerBorder = new Border { CornerRadius = new CornerRadius(18, 18, 0, 0), Padding = new Thickness(24, 14, 16, 14) };
        var hdrGrid = new Grid();
        hdrGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hdrGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hdrGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _title = new TextBlock { Text = "Sparky", FontFamily = AppFont, FontSize = 16, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(_title, 0);

        _themeToggle = MakeIconBtn("\u2600", 15);
        _themeToggle.ToolTip = "Dark / Light";
        _themeToggle.Click += (_, __) => { _isDark = !_isDark; ApplyTheme(); };
        Grid.SetColumn(_themeToggle, 1);

        var btnClose = MakeIconBtn("\u2715", 14);
        btnClose.Click += (_, __) => Close();
        Grid.SetColumn(btnClose, 2);

        hdrGrid.Children.Add(_title);
        hdrGrid.Children.Add(_themeToggle);
        hdrGrid.Children.Add(btnClose);
        _headerBorder.Child = hdrGrid;
        Grid.SetRow(_headerBorder, 0);
        root.Children.Add(_headerBorder);

        // ── Main scroll area ────────────────────────────────────────────────
        _contentStack = new StackPanel { Margin = new Thickness(20, 16, 20, 12) };
        _mainScroll = new ScrollViewer
        {
            Content = _contentStack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        Grid.SetRow(_mainScroll, 1);
        root.Children.Add(_mainScroll);

        // ── Editable text bubble ────────────────────────────────────────────
        _editLabel = new TextBlock
        {
            Text = "Markierter Text",
            FontFamily = AppFont,
            FontSize = 10.5,
            Margin = new Thickness(2, 0, 0, 5)
        };

        _editBox = new TextBox
        {
            Text = _originalText,
            AcceptsReturn = true,
            AcceptsTab = false,
            TextWrapping = TextWrapping.Wrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,   // outer scroll handles it
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            FontFamily = AppFont,
            FontSize = 14,
            Padding = new Thickness(0),
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent
        };
        _editBox.GotFocus  += (_, __) => _micTargetIsEdit = true;
        _editBox.LostFocus += (_, __) => { /* keep _micTargetIsEdit = true until input focused */ };

        var editInner = new StackPanel();
        editInner.Children.Add(_editLabel);
        editInner.Children.Add(_editBox);

        _editBubble = MakeBubbleBorder();
        _editBubble.Child = editInner;
        _contentStack.Children.Add(_editBubble);

        // ── Actions row (Compress + Save) ───────────────────────────────────
        _actionsRow = new Border { Margin = new Thickness(0, 8, 0, 4) };
        var actStack = new StackPanel { Orientation = Orientation.Horizontal };
        _btnCompress = MakeActionBtn("Compress", AccentGreen);
        _btnCompress.Click += async (_, __) => await CompressAsync();
        actStack.Children.Add(_btnCompress);

        _btnSave = MakeActionBtn("In Obsidian speichern", AccentBlue);
        _btnSave.Click += async (_, __) => await SaveToBrainAsync();
        actStack.Children.Add(_btnSave);
        _actionsRow.Child = actStack;
        _contentStack.Children.Add(_actionsRow);

        // ── Input bar ───────────────────────────────────────────────────────
        _inputWrap = new Border { Padding = new Thickness(16, 10, 16, 16) };
        var inGrid = new Grid();
        inGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _inputBox = new TextBox
        {
            AcceptsReturn = false,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 44, MaxHeight = 120,
            Padding = new Thickness(16, 12, 16, 12),
            FontFamily = AppFont,
            FontSize = 14,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Text = "Frage an Sparky ..."
        };
        _inputBox.GotFocus += (_, __) =>
        {
            _micTargetIsEdit = false;
            if (_inputBox.Text == "Frage an Sparky ...") { _inputBox.Text = ""; }
        };
        _inputBox.LostFocus += (_, __) =>
        {
            if (string.IsNullOrWhiteSpace(_inputBox.Text)) _inputBox.Text = "Frage an Sparky ...";
        };
        _inputBox.KeyDown += async (_, e) =>
        {
            if (e.Key == Key.Enter && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
            { e.Handled = true; await SendMessageAsync(); }
        };
        Grid.SetColumn(_inputBox, 0);
        inGrid.Children.Add(_inputBox);

        // Mic button: outline circle with microphone glyph (Segoe MDL2)
        _btnMic = MakeCircleBtn(
            label: "\uE720",
            fontFamily: new FontFamily("Segoe MDL2 Assets"),
            fontSize: 16,
            size: 44,
            filled: false);
        _btnMic.Margin = new Thickness(10, 0, 8, 0);
        _btnMic.Click += (_, __) => ToggleMic();
        Grid.SetColumn(_btnMic, 1);
        inGrid.Children.Add(_btnMic);

        // Send button: filled circle with up-arrow
        _btnSend = MakeCircleBtn(
            label: "\u2191",
            fontFamily: AppFont,
            fontSize: 20,
            size: 44,
            filled: true);
        _btnSend.FontWeight = FontWeights.Bold;
        _btnSend.Click += async (_, __) => await SendMessageAsync();
        Grid.SetColumn(_btnSend, 2);
        inGrid.Children.Add(_btnSend);

        _inputWrap.Child = inGrid;
        Grid.SetRow(_inputWrap, 2);
        root.Children.Add(_inputWrap);

        Content = _card;

        // ── Mic pulse timer ────────────────────────────────────────────────
        _micPulseTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _micPulseTimer.Tick += (_, __) =>
        {
            if (_micTranscribing)
            {
                var frames = new[] { "\u23f3", "\u23f3.", "\u23f3..", "\u23f3..." };
                _btnMic.Content    = frames[_micPulseFrame % frames.Length];
                _btnMic.FontFamily = AppFont;
                _btnMic.FontSize   = 11;
                _micPulseFrame++;
            }
            else if (_micRecording)
            {
                // Alternate border opacity for recording pulse
                bool bright = (_micPulseFrame % 2 == 0);
                _btnMic.BorderBrush = new SolidColorBrush(bright
                    ? DangerRed
                    : Color.FromArgb(140, DangerRed.R, DangerRed.G, DangerRed.B));
                _micPulseFrame++;
            }
        };

        KeyDown += (_, e) => { if (e.Key == Key.Escape) Close(); };
        Loaded += async (_, __) =>
        {
            ApplyTheme();
            _editBox.Focus();
            _editBox.CaretIndex = _editBox.Text.Length;
            if (autoCompress) await CompressAsync();
        };
    }

    // ── Theme ──────────────────────────────────────────────────────────────
    private void ApplyTheme()
    {
        Color bg      = _isDark ? Dark.Bg      : Light.Bg;
        Color hdr     = _isDark ? Dark.Header   : Light.Header;
        Color bubble  = _isDark ? Dark.Bubble   : Light.Bubble;
        Color border  = _isDark ? Dark.Border   : Light.Border;
        Color text    = _isDark ? Dark.Text     : Light.Text;
        Color muted   = _isDark ? Dark.Muted    : Light.Muted;
        Color inputBg = _isDark ? Dark.InputBg  : Light.InputBg;
        Color sendBtn = _isDark ? Dark.SendBtn  : Light.SendBtn;
        Color sendFg  = _isDark ? Dark.SendFg   : Light.SendFg;

        _card.Background      = new SolidColorBrush(bg);
        _card.BorderBrush     = new SolidColorBrush(border);
        _card.BorderThickness = new Thickness(1);

        _headerBorder.Background = new SolidColorBrush(hdr);
        _title.Foreground        = new SolidColorBrush(text);
        _themeToggle.Content     = _isDark ? "\u2600" : "\u263d";
        _themeToggle.Foreground  = new SolidColorBrush(muted);

        _editBubble.Background  = new SolidColorBrush(bubble);
        _editBubble.BorderBrush = new SolidColorBrush(border);
        _editLabel.Foreground   = new SolidColorBrush(muted);
        _editBox.Foreground     = new SolidColorBrush(text);
        _editBox.CaretBrush     = new SolidColorBrush(text);
        _editBox.SelectionBrush = new SolidColorBrush(Color.FromArgb(80, AccentBlue.R, AccentBlue.G, AccentBlue.B));

        _inputWrap.BorderBrush     = new SolidColorBrush(border);
        _inputWrap.BorderThickness = new Thickness(0, 1, 0, 0);
        _inputBox.Background      = new SolidColorBrush(inputBg);
        _inputBox.Foreground      = new SolidColorBrush(_inputBox.Text == "Frage an Sparky ..." ? muted : text);
        _inputBox.CaretBrush      = new SolidColorBrush(text);
        _inputBox.BorderBrush     = new SolidColorBrush(border);
        _inputBox.BorderThickness = new Thickness(1);

        // Mic button: outline, no fill
        _btnMic.Background = Brushes.Transparent;
        _btnMic.BorderBrush = new SolidColorBrush(border);
        _btnMic.Foreground  = new SolidColorBrush(text);

        // Send button: filled circle
        _btnSend.Background = new SolidColorBrush(sendBtn);
        _btnSend.Foreground = new SolidColorBrush(sendFg);

        // Recolor existing chat bubbles
        foreach (var child in _contentStack.Children)
        {
            if (child is Border b && b.Tag is string tag)
            {
                if (tag == "user")
                {
                    b.Background  = new SolidColorBrush(_isDark ? Dark.UserBubble  : Light.UserBubble);
                    b.BorderBrush = new SolidColorBrush(border);
                    if (b.Child is TextBlock tb1) tb1.Foreground = new SolidColorBrush(text);
                }
                else if (tag == "spark")
                {
                    b.Background  = new SolidColorBrush(_isDark ? Dark.SparkBubble : Light.SparkBubble);
                    b.BorderBrush = new SolidColorBrush(border);
                    if (b.Child is TextBlock tb2) tb2.Foreground = new SolidColorBrush(
                        tb2.FontStyle == FontStyles.Italic ? muted : text);
                }
            }
        }
    }

    // ── Mic ────────────────────────────────────────────────────────────────
    private void ToggleMic()
    {
        if (_micTranscribing) return;
        if (_micRecording) { StopRecording(); return; }
        StartRecording();
    }

    private void StartRecording()
    {
        if (_micRecording) return;
        _micRecording  = true;
        _micPulseFrame = 0;
        _audioBuffer   = new MemoryStream();
        _wasapiCapture = null;
        _waveInFallback = null;

        // Recording UI
        _btnMic.Background  = new SolidColorBrush(Color.FromArgb(30, DangerRed.R, DangerRed.G, DangerRed.B));
        _btnMic.BorderBrush = new SolidColorBrush(DangerRed);
        _btnMic.Effect      = new DropShadowEffect { Color = DangerRed, BlurRadius = 12, ShadowDepth = 0, Opacity = 0.25 };
        _micPulseTimer.Start();

        // Device enumeration — same order as AWW
        MMDevice? micDevice = null;
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            try   { micDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications); }
            catch { try   { micDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console); }
                    catch { micDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia); } }
        }
        catch (Exception ex)
        {
            _micRecording = false; _audioBuffer = null;
            Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble($"Mikrofon-Fehler: {ex.Message}"); });
            return;
        }

        try
        {
            _wasapiCapture = new WasapiCapture(micDevice);
        }
        catch (Exception wasapiEx)
        {
            micDevice.Dispose();
            try
            {
                _waveInFallback = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 100 };
            }
            catch (Exception fbEx)
            {
                _micRecording = false; _audioBuffer = null;
                Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble($"Mikrofon-Fehler: {wasapiEx.Message} / Fallback: {fbEx.Message}"); });
                return;
            }

            _waveInFallback.DataAvailable += (_, ev) => _audioBuffer?.Write(ev.Buffer, 0, ev.BytesRecorded);
            _waveInFallback.RecordingStopped += async (_, __) =>
            {
                _waveInFallback?.Dispose(); _waveInFallback = null;
                _micRecording = false;
                var raw = _audioBuffer?.ToArray() ?? Array.Empty<byte>(); _audioBuffer = null;
                await OnMicCaptureStoppedAsync(raw, null);
            };
            _waveInFallback.StartRecording();
            return;
        }

        var captureFormat = _wasapiCapture.WaveFormat;
        _wasapiCapture.DataAvailable += (_, ev) => _audioBuffer?.Write(ev.Buffer, 0, ev.BytesRecorded);
        _wasapiCapture.RecordingStopped += async (_, __) =>
        {
            _wasapiCapture?.Dispose(); _wasapiCapture = null;
            _micRecording = false;
            var raw = _audioBuffer?.ToArray() ?? Array.Empty<byte>(); _audioBuffer = null;
            await OnMicCaptureStoppedAsync(raw, captureFormat);
        };
        _wasapiCapture.StartRecording();
    }

    private void StopRecording()
    {
        if (!_micRecording) return;
        try { _wasapiCapture?.StopRecording(); } catch { }
        try { _waveInFallback?.StopRecording(); } catch { }
    }

    private const int MinPcm16Bytes = 16000; // ~0.5 s @ 16 kHz 16-bit mono

    private async Task OnMicCaptureStoppedAsync(byte[] raw, WaveFormat? wasapiSourceFormat)
    {
        var data = raw;
        if (wasapiSourceFormat != null && raw.Length > 0)
        {
            try
            {
                using var ms  = new MemoryStream(raw);
                using var src = new RawSourceWaveStream(ms, wasapiSourceFormat);
                ISampleProvider pipe = src.ToSampleProvider();
                if      (pipe.WaveFormat.Channels == 2) pipe = pipe.ToMono();
                else if (pipe.WaveFormat.Channels >  2) pipe = new NAudio.Wave.SampleProviders.MultiplexingSampleProvider(new[] { pipe }, 1);
                if (pipe.WaveFormat.SampleRate != 16000) pipe = new NAudio.Wave.SampleProviders.WdlResamplingSampleProvider(pipe, 16000);
                var pcm16 = pipe.ToWaveProvider16();
                using var outMs = new MemoryStream(); var buf = new byte[4096]; int read;
                while ((read = pcm16.Read(buf, 0, buf.Length)) > 0) outMs.Write(buf, 0, read);
                data = outMs.ToArray();
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble($"Audio-Aufbereitung: {ex.Message}"); });
                return;
            }
        }

        if (data.Length < MinPcm16Bytes)
        {
            Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble("Aufnahme zu kurz."); });
            return;
        }

        // Switch to transcribing state
        Dispatcher.Invoke(() =>
        {
            _micTranscribing = true;
            _micPulseFrame   = 0;
            _btnMic.Content    = "\u23f3";
            _btnMic.FontFamily = AppFont;
            _btnMic.FontSize   = 11;
            _btnMic.Background  = Brushes.Transparent;
            _btnMic.Effect      = null;
            _btnMic.BorderBrush = new SolidColorBrush(_isDark ? Dark.Border : Light.Border);
        });

        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var payload = JsonSerializer.Serialize(new
            {
                audioBase64 = Convert.ToBase64String(data),
                mimeType    = "audio/pcm",
                sampleRate  = 16000
            });
            var res  = await http.PostAsync($"{CompanionBaseUrl()}/stt", new StringContent(payload, Encoding.UTF8, "application/json"));
            var json = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                var errMsg = json;
                try { using var ed = JsonDocument.Parse(json); if (ed.RootElement.TryGetProperty("error", out var ee)) errMsg = ee.GetString() ?? json; } catch { }
                if (errMsg.Length > 280) errMsg = errMsg[..277] + "...";
                Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble($"Transkription fehlgeschlagen ({res.StatusCode}): {errMsg}"); });
                return;
            }

            using var doc = JsonDocument.Parse(json);

            if (doc.RootElement.TryGetProperty("error", out var errEl))
            {
                Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble($"STT: {errEl.GetString() ?? "unbekannter Fehler"}"); });
                return;
            }

            var transcript = doc.RootElement.TryGetProperty("text", out var t) ? (t.GetString() ?? "").Trim() : "";

            Dispatcher.Invoke(() =>
            {
                ResetMicUi();
                if (string.IsNullOrWhiteSpace(transcript)) { AppendSparkBubble("Nichts erkannt. Bitte nochmal versuchen."); return; }

                if (_micTargetIsEdit)
                {
                    // Insert as [Gedanke] at current cursor position in editBox
                    var insertion = $"\n> [Gedanke]\n{transcript}";
                    int pos = _editBox.CaretIndex;
                    _editBox.Text       = _editBox.Text.Insert(pos, insertion);
                    _editBox.CaretIndex = pos + insertion.Length;
                    _editBox.Focus();
                }
                else
                {
                    // Append to input field
                    var cur = (_inputBox.Text == "Frage an Sparky ..." ? "" : _inputBox.Text).TrimEnd();
                    _inputBox.Text      = string.IsNullOrEmpty(cur) ? transcript : cur + " " + transcript;
                    _inputBox.CaretIndex = _inputBox.Text.Length;
                    _inputBox.Focus();
                }
            });
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() => { ResetMicUi(); AppendSparkBubble($"Transkription-Fehler: {ex.Message}"); });
        }
    }

    private void ResetMicUi()
    {
        _micRecording    = false;
        _micTranscribing = false;
        _micPulseTimer.Stop();
        _btnMic.Content    = "\uE720";
        _btnMic.FontFamily = new FontFamily("Segoe MDL2 Assets");
        _btnMic.FontSize   = 16;
        _btnMic.Background = Brushes.Transparent;
        _btnMic.BorderBrush = new SolidColorBrush(_isDark ? Dark.Border : Light.Border);
        _btnMic.Effect     = null;
    }

    // ── Compress ───────────────────────────────────────────────────────────
    private async Task CompressAsync()
    {
        var content = _editBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(content)) return;

        _btnCompress.IsEnabled = false; _btnCompress.Content = "Komprimiere ...";
        AppendSparkBubble("Komprimiere ...", loading: true);
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var res  = await http.PostAsync($"{CompanionBaseUrl()}/brain/compress-preview", Json(new { content }));
            var body = await res.Content.ReadAsStringAsync();
            RemoveLoading();
            if (!res.IsSuccessStatusCode) { AppendSparkBubble("Komprimierung fehlgeschlagen."); return; }

            using var doc = JsonDocument.Parse(body);
            var compressed   = doc.RootElement.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
            _compressedModel = doc.RootElement.TryGetProperty("model",   out var m) ? m.GetString() : "";

            _editBox.Text  = compressed;
            _editLabel.Text = $"Komprimiert (KI: {_compressedModel ?? "?"})";
            var note = string.IsNullOrWhiteSpace(_compressedModel) ? "" : $" [{_compressedModel}]";
            AppendSparkBubble($"Komprimiert{note} - Text oben ersetzt.");
        }
        catch (Exception ex) { RemoveLoading(); AppendSparkBubble($"Fehler: {ex.Message}"); }
        finally { _btnCompress.Content = "Compress"; _btnCompress.IsEnabled = true; }
    }

    // ── Save in Obsidian ───────────────────────────────────────────────────
    private async Task SaveToBrainAsync()
    {
        var fullText = _editBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(fullText)) return;

        var contentLines = new List<string>();
        var thoughtLines = new List<string>();
        bool inThought = false;
        foreach (var line in fullText.Split('\n'))
        {
            var tr = line.TrimStart();
            if (tr.StartsWith("> [Gedanke]") || tr.StartsWith(">[Gedanke]"))
                { inThought = true; continue; }
            else if (inThought && tr.StartsWith(">"))
                thoughtLines.Add(tr.TrimStart('>').Trim());
            else
                { inThought = false; contentLines.Add(line); }
        }
        var content   = string.Join("\n", contentLines).Trim();
        var userNotes = string.Join("\n", thoughtLines).Trim();
        if (string.IsNullOrWhiteSpace(content)) content = fullText;

        _btnSave.IsEnabled = false; _btnSave.Content = "Speichere ...";
        AppendSparkBubble("Speichere in Obsidian ...", loading: true);
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            string? title = null, type = null, themenpfad = null, parentIndex = null;
            var related = new List<string>();

            var clsRes = await http.PostAsync($"{CompanionBaseUrl()}/brain/classify", Json(new { content }));
            if (clsRes.IsSuccessStatusCode)
            {
                using var d = JsonDocument.Parse(await clsRes.Content.ReadAsStringAsync());
                var r = d.RootElement;
                if (r.TryGetProperty("title",          out var ti)) title       = ti.GetString();
                if (r.TryGetProperty("type",           out var ty)) type        = ty.GetString();
                if (r.TryGetProperty("themenpfad",     out var th)) themenpfad  = th.GetString();
                if (r.TryGetProperty("parentIndex",    out var p) && p.ValueKind != JsonValueKind.Null) parentIndex = p.GetString();
                if (r.TryGetProperty("relatedIndices", out var rel) && rel.ValueKind == JsonValueKind.Array)
                    foreach (var x in rel.EnumerateArray()) { var s = x.GetString(); if (!string.IsNullOrWhiteSpace(s)) related.Add(s!); }
            }

            var payload = new Dictionary<string, object?>
            {
                ["content"]        = content,   ["title"]       = title,
                ["type"]           = type,       ["themenpfad"]  = themenpfad,
                ["parentIndex"]    = parentIndex, ["relatedIndices"] = related,
                ["source"]         = "spark-popup", ["aiModel"]  = _compressedModel,
                ["originalSource"] = _originalText.Length > 600 ? _originalText[..600] : _originalText,
                ["userNotes"]      = string.IsNullOrWhiteSpace(userNotes) ? null : userNotes
            };

            var saveRes  = await http.PostAsync($"{CompanionBaseUrl()}/brain/save", Json(payload));
            var saveBody = await saveRes.Content.ReadAsStringAsync();
            RemoveLoading();

            if (saveRes.IsSuccessStatusCode)
            {
                using var d2 = JsonDocument.Parse(saveBody);
                var idx      = d2.RootElement.TryGetProperty("index",    out var ix) ? ix.GetString() ?? "" : "";
                var markdown = d2.RootElement.TryGetProperty("markdown", out var md) ? md.GetString() ?? "" : "";
                if (!string.IsNullOrWhiteSpace(markdown))
                {
                    _editBox.Text    = markdown;
                    _editBox.IsReadOnly = true;
                    _editLabel.Text  = $"\u2713  Gespeichert als {idx}  (Vorschau)";
                }
                AppendSparkBubble($"\u2713  In Obsidian gespeichert  ({idx})");
                _btnSave.Content = "\u2713  Gespeichert";
            }
            else
            {
                AppendSparkBubble("Fehler beim Speichern.");
                _btnSave.IsEnabled = true; _btnSave.Content = "In Obsidian speichern";
            }
        }
        catch (Exception ex)
        {
            RemoveLoading(); AppendSparkBubble($"Fehler: {ex.Message}");
            _btnSave.IsEnabled = true; _btnSave.Content = "In Obsidian speichern";
        }
    }

    // ── Chat ───────────────────────────────────────────────────────────────
    private async Task SendMessageAsync()
    {
        var question = _inputBox.Text == "Frage an Sparky ..." ? "" : _inputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(question)) return;

        AppendUserBubble(question);
        _inputBox.Text     = "Frage an Sparky ...";
        _inputBox.Foreground = new SolidColorBrush(_isDark ? Dark.Muted : Light.Muted);
        _btnSend.IsEnabled = false;
        AppendSparkBubble("Denke nach ...", loading: true);

        try
        {
            var ctx  = _editBox.Text.Trim();
            var msg  = string.IsNullOrWhiteSpace(ctx) ? $"Frage: {question}" : $"Kontext:\n{ctx}\n\nFrage: {question}";
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var res  = await http.PostAsync($"{CompanionBaseUrl()}/chat", Json(new { message = msg }));
            var body = await res.Content.ReadAsStringAsync();
            RemoveLoading();
            if (!res.IsSuccessStatusCode) { AppendSparkBubble("Antwort fehlgeschlagen."); return; }
            using var doc = JsonDocument.Parse(body);
            AppendSparkBubble(doc.RootElement.TryGetProperty("reply", out var rp) ? rp.GetString() ?? "" : "");
        }
        catch (Exception ex) { RemoveLoading(); AppendSparkBubble($"Fehler: {ex.Message}"); }
        finally { _btnSend.IsEnabled = true; _inputBox.Focus(); }
    }

    // ── Bubble helpers ─────────────────────────────────────────────────────
    private void AppendUserBubble(string text)
    {
        Color border = _isDark ? Dark.Border : Light.Border;
        var b = new Border
        {
            Tag = "user",
            Background        = new SolidColorBrush(_isDark ? Dark.UserBubble  : Light.UserBubble),
            BorderBrush       = new SolidColorBrush(border),
            BorderThickness   = new Thickness(1),
            CornerRadius      = new CornerRadius(16, 16, 4, 16),
            Padding           = new Thickness(16, 11, 16, 11),
            Margin            = new Thickness(60, 6, 0, 2),
            HorizontalAlignment = HorizontalAlignment.Right
        };
        b.Child = new TextBlock { Text = text, FontFamily = AppFont, Foreground = new SolidColorBrush(_isDark ? Dark.Text : Light.Text), FontSize = 14, TextWrapping = TextWrapping.Wrap };
        _contentStack.Children.Add(b);
        ScrollToEnd();
    }

    private void AppendSparkBubble(string text, bool loading = false)
    {
        Color border = _isDark ? Dark.Border : Light.Border;
        Color muted  = _isDark ? Dark.Muted  : Light.Muted;
        var b = new Border
        {
            Tag = "spark",
            Background      = new SolidColorBrush(_isDark ? Dark.SparkBubble : Light.SparkBubble),
            BorderBrush     = new SolidColorBrush(border),
            BorderThickness = new Thickness(1),
            CornerRadius    = new CornerRadius(4, 16, 16, 16),
            Padding         = new Thickness(16, 11, 16, 11),
            Margin          = new Thickness(0, 6, 60, 2),
            HorizontalAlignment = HorizontalAlignment.Left
        };
        b.Child = new TextBlock
        {
            Text         = text, FontFamily = AppFont,
            Foreground   = new SolidColorBrush(loading ? muted : (_isDark ? Dark.Text : Light.Text)),
            FontSize     = 14,
            FontStyle    = loading ? FontStyles.Italic : FontStyles.Normal,
            TextWrapping = TextWrapping.Wrap
        };
        if (loading) _loadingBubble = b;
        _contentStack.Children.Add(b);
        ScrollToEnd();
    }

    private void RemoveLoading()
    {
        if (_loadingBubble != null && _contentStack.Children.Contains(_loadingBubble))
            _contentStack.Children.Remove(_loadingBubble);
        _loadingBubble = null;
    }

    private void ScrollToEnd() { _mainScroll.UpdateLayout(); _mainScroll.ScrollToEnd(); }

    // ── UI factories ───────────────────────────────────────────────────────
    private static Border MakeBubbleBorder() => new Border
    {
        CornerRadius    = new CornerRadius(14),
        BorderThickness = new Thickness(1),
        Padding         = new Thickness(18, 14, 18, 14),
        Margin          = new Thickness(0, 0, 0, 4)
    };

    private static Button MakeIconBtn(string label, double size) => new Button
    {
        Content = label, FontSize = size, Width = 32, Height = 32,
        Background = Brushes.Transparent, BorderThickness = new Thickness(0),
        Cursor = Cursors.Hand, VerticalContentAlignment = VerticalAlignment.Center, Padding = new Thickness(0)
    };

    /// <summary>Circle button — filled or outline style.</summary>
    private static Button MakeCircleBtn(string label, FontFamily fontFamily, double fontSize, double size, bool filled)
    {
        var btn = new Button
        {
            Content  = label,
            FontFamily = fontFamily,
            FontSize = fontSize,
            Width = size, Height = size,
            Cursor = Cursors.Hand,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment   = VerticalAlignment.Center,
            Padding = new Thickness(0)
        };

        // Override template to get true circle shape
        var tpl = new ControlTemplate(typeof(Button));
        var borderFactory = new FrameworkElementFactory(typeof(Border));
        borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(size / 2));
        borderFactory.SetBinding(Border.BackgroundProperty,  new Binding("Background") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        borderFactory.SetBinding(Border.BorderBrushProperty, new Binding("BorderBrush") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) });
        borderFactory.SetValue(Border.BorderThicknessProperty, new Thickness(filled ? 0 : 1.5));
        var cp = new FrameworkElementFactory(typeof(ContentPresenter));
        cp.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        cp.SetValue(ContentPresenter.VerticalAlignmentProperty,   VerticalAlignment.Center);
        borderFactory.AppendChild(cp);
        tpl.VisualTree = borderFactory;
        btn.Template = tpl;

        if (!filled)
        {
            btn.Background   = Brushes.Transparent;
            btn.BorderBrush  = new SolidColorBrush(Dark.Border);
            btn.Foreground   = new SolidColorBrush(Dark.Text);
        }
        return btn;
    }

    private static Button MakeActionBtn(string label, Color accent) => new Button
    {
        Content = label, FontFamily = AppFont,
        Padding = new Thickness(14, 7, 14, 7), Margin = new Thickness(0, 0, 8, 0), FontSize = 12.5,
        Background      = new SolidColorBrush(Color.FromArgb(32, accent.R, accent.G, accent.B)),
        Foreground      = new SolidColorBrush(accent),
        BorderBrush     = new SolidColorBrush(Color.FromArgb(60, accent.R, accent.G, accent.B)),
        BorderThickness = new Thickness(1), Cursor = Cursors.Hand
    };

    private static StringContent Json(object obj) =>
        new StringContent(JsonSerializer.Serialize(obj), Encoding.UTF8, "application/json");
}
