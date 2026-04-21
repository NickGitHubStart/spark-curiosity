using System;
using System.Diagnostics;
using System.Linq;
using System.Collections.Generic;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

/// <summary>
/// Detects active audio playback on the local machine via WASAPI.
/// Returns the loudest currently-playing session (or null when all outputs are silent).
/// Fast, safe to call on every foreground change (single enumeration of render endpoints).
/// </summary>
internal static class AudioMonitor
{
    // Cached enumerator — MMDeviceEnumerator is expensive to construct repeatedly.
    private static MMDeviceEnumerator? _enum;

    // Peak threshold under which we consider a session "silent" (ignore background apps
    // that declare themselves active but emit no real audio).
    private const float PeakThreshold = 0.003f;

    internal sealed class Snapshot
    {
        public string pkg { get; set; } = "";
        public string? title { get; set; }
        public string state { get; set; } = "playing";
        public int peak { get; set; } // 0–100 percent
        public int sessions { get; set; }
    }

    public static Snapshot? TrySnapshot()
    {
        try
        {
            _enum ??= new MMDeviceEnumerator();
            MMDeviceCollection devices;
            try { devices = _enum.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active); }
            catch { return null; }

            var candidates = new List<(string procName, string? title, float peak)>();

            for (int d = 0; d < devices.Count; d++)
            {
                MMDevice dev;
                try { dev = devices[d]; } catch { continue; }
                try
                {
                    AudioSessionManager mgr;
                    try { mgr = dev.AudioSessionManager; } catch { continue; }

                    SessionCollection sessions;
                    try { sessions = mgr.Sessions; } catch { continue; }

                    for (int s = 0; s < sessions.Count; s++)
                    {
                        AudioSessionControl session;
                        try { session = sessions[s]; } catch { continue; }

                        try
                        {
                            if (session.State != AudioSessionState.AudioSessionStateActive) continue;
                            if (session.SimpleAudioVolume?.Mute == true) continue;

                            float peak = 0f;
                            try { peak = session.AudioMeterInformation?.MasterPeakValue ?? 0f; } catch { }
                            if (peak < PeakThreshold) continue;

                            uint pid = 0;
                            try { pid = session.GetProcessID; } catch { }
                            if (pid == 0) continue;

                            string procName = "";
                            string? title = null;
                            try
                            {
                                using var p = Process.GetProcessById((int)pid);
                                procName = p.ProcessName ?? "";
                                try
                                {
                                    var t = p.MainWindowTitle;
                                    if (!string.IsNullOrWhiteSpace(t)) title = t.Trim();
                                }
                                catch { }
                            }
                            catch { }
                            if (string.IsNullOrWhiteSpace(procName)) continue;

                            candidates.Add((procName, title, peak));
                        }
                        catch { }
                    }
                }
                catch { }
            }

            if (candidates.Count == 0) return null;

            var loudest = candidates.OrderByDescending(c => c.peak).First();
            return new Snapshot
            {
                pkg = loudest.procName,
                title = loudest.title,
                state = "playing",
                peak = (int)Math.Min(100, Math.Round(loudest.peak * 100)),
                sessions = candidates.Count
            };
        }
        catch { return null; }
    }
}
