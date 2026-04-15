using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

internal static partial class Program
{
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

        window.SourceInitialized += (_, __) =>
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            var exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
        };

        var root = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(17, 24, 45)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(36, 48, 79)),
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

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var contentStack = new StackPanel { Margin = new Thickness(0, 0, 50, 0) };
        Grid.SetRow(contentStack, 0);
        Grid.SetColumn(contentStack, 0);

        var quoteMark = new TextBlock
        {
            Text = "\u201C",
            FontFamily = new FontFamily("Georgia"),
            FontSize = 42,
            Foreground = new SolidColorBrush(Color.FromArgb(60, 74, 138, 245)),
            Margin = new Thickness(0, 0, 0, 2)
        };
        contentStack.Children.Add(quoteMark);

        var quoteBlock = new TextBlock
        {
            Text = safeText,
            Foreground = new SolidColorBrush(Color.FromRgb(219, 231, 255)),
            TextWrapping = TextWrapping.Wrap,
            FontSize = 17,
            LineHeight = 26,
            Margin = new Thickness(0, 0, 0, hasAuthor ? 10 : 0)
        };
        contentStack.Children.Add(quoteBlock);

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
            catch { }
        }

        upBtn.Click += (_, __) => { SendFeedback("up"); window.Close(); };
        downBtn.Click += (_, __) => { SendFeedback("down"); window.Close(); };

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
            Cursor = Cursors.Hand,
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
}
