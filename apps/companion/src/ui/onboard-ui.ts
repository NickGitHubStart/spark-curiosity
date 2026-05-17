export function renderOnboardPage(lang: "de" | "en" = "de"): string {
  const langJson = JSON.stringify(lang);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark</title>
<style>
  :root{--bg:#0b0f1e;--panel:#11182d;--border:#24304f;--text:#e8eefc;--muted:#95a3c7;--accent:#4a8af5;--accent2:#34d399;--danger:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:radial-gradient(1200px 600px at 50% -20%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif;min-height:100vh}

  .container{max-width:860px;margin:0 auto;padding:40px 24px 60px}
  .hero{text-align:center;margin-bottom:40px}
  .hero h1{font-size:32px;margin:0 0 8px;background:linear-gradient(135deg,#4a8af5,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .hero p{color:var(--muted);font-size:15px;max-width:520px;margin:0 auto;line-height:1.6}

  .step{display:none}
  .step.active{display:block}

  .step-indicator{display:flex;justify-content:center;gap:8px;margin-bottom:32px}
  .dot{width:10px;height:10px;border-radius:50%;background:#1e2a48;transition:background .3s}
  .dot.active{background:var(--accent)}
  .dot.done{background:var(--accent2)}

  .templates{display:grid;grid-template-columns:1fr;gap:16px}
  .tpl{background:var(--panel);border:2px solid var(--border);border-radius:16px;padding:22px 24px;cursor:pointer;transition:border-color .2s,transform .15s,box-shadow .2s}
  .tpl:hover{border-color:#3a5a9f;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3)}
  .tpl.selected{border-color:var(--accent);box-shadow:0 0 0 3px rgba(74,138,245,0.2)}
  .tpl h3{margin:0 0 6px;font-size:18px;color:#dbe7ff}
  .tpl .desc{color:var(--muted);font-size:13px;margin-bottom:12px;line-height:1.5}
  .tpl .highlights{display:flex;flex-wrap:wrap;gap:6px}
  .tpl .hl{background:#0d2520;color:#86efac;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:600}

  .wishes-section{margin-top:8px}
  .wishes-section label{display:block;font-size:14px;color:#b9c7e6;margin-bottom:8px}
  .wishes-composer{display:flex;gap:8px;align-items:flex-end;margin-top:8px}
  .wishes-composer textarea{
    flex:1;min-height:120px;resize:vertical;background:#0a1328;border:1px solid #2a3a62;border-radius:12px;
    padding:14px;color:var(--text);font-size:14px;font-family:inherit;line-height:1.5
  }
  .wishes-composer textarea::placeholder{color:#5a6d94}
  .btn{border:1px solid #2a3a62;background:#0a1328;color:var(--text);border-radius:10px;cursor:pointer;font-weight:600}
  .btn.mic{width:42px;min-height:42px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s ease;padding:0}
  .btn.mic.recording{
    background:rgba(239,68,68,.12);border-color:var(--danger);color:var(--danger);
    box-shadow:0 0 0 3px rgba(239,68,68,.15);animation:mic-pulse-chat 1.8s ease-in-out infinite;
  }
  @keyframes mic-pulse-chat{
    0%,100%{box-shadow:0 0 0 3px rgba(239,68,68,.15)}
    50%{box-shadow:0 0 0 8px rgba(239,68,68,.08)}
  }
  .wave-container{
    display:none;flex:1;min-height:42px;align-items:center;gap:2px;
    background:linear-gradient(135deg,rgba(239,68,68,.06),rgba(239,68,68,.02));
    border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:0 14px;position:relative;overflow:hidden;
  }
  .wave-container::before{
    content:'';position:absolute;inset:0;
    background:linear-gradient(90deg,transparent,rgba(239,68,68,.04),transparent);
    animation:wave-sweep 2s ease-in-out infinite;
  }
  @keyframes wave-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
  .wave-container.active{display:flex}
  .wave-bar{
    width:3px;border-radius:99px;
    background:linear-gradient(180deg,var(--danger),rgba(239,68,68,.4));
    animation:wave-bars 1s ease-in-out infinite;
  }
  .wave-bar:nth-child(1){height:6px;animation-delay:0s}
  .wave-bar:nth-child(2){height:14px;animation-delay:.08s}
  .wave-bar:nth-child(3){height:22px;animation-delay:.16s}
  .wave-bar:nth-child(4){height:28px;animation-delay:.24s}
  .wave-bar:nth-child(5){height:22px;animation-delay:.12s}
  .wave-bar:nth-child(6){height:14px;animation-delay:.2s}
  .wave-bar:nth-child(7){height:18px;animation-delay:.28s}
  .wave-bar:nth-child(8){height:10px;animation-delay:.32s}
  .wave-bar:nth-child(9){height:24px;animation-delay:.04s}
  .wave-bar:nth-child(10){height:16px;animation-delay:.36s}
  .wave-bar:nth-child(11){height:8px;animation-delay:.4s}
  @keyframes wave-bars{0%,100%{transform:scaleY(.3);opacity:.4}50%{transform:scaleY(1);opacity:1}}
  .rec-time{color:var(--danger);font-size:11px;font-weight:700;margin-left:10px;min-width:28px;letter-spacing:.3px}
  .rec-stop{
    margin-left:6px;width:24px;height:24px;border-radius:8px;border:none;
    background:var(--danger);cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:transform .15s;flex-shrink:0;
  }
  .rec-stop:hover{transform:scale(1.1)}
  .rec-stop::after{content:'';display:block;width:8px;height:8px;border-radius:2px;background:#fff}
  .mic-status{font-size:12px;color:var(--muted);margin-top:8px;min-height:18px}
  .mic-status.err{color:var(--danger)}

  .nav{display:flex;justify-content:space-between;align-items:center;margin-top:28px;gap:12px}
  .btn{border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer;transition:transform .1s,box-shadow .2s}
  .btn:active{transform:scale(.97)}
  .btn-primary{background:linear-gradient(135deg,#4a8af5,#3672d9);color:#fff;box-shadow:0 4px 16px rgba(74,138,245,0.3)}
  .btn-primary:hover{box-shadow:0 6px 20px rgba(74,138,245,0.45)}
  .btn-primary:disabled{opacity:.5;cursor:not-allowed}
  .btn-ghost{background:transparent;border:1px solid #2a3a62;color:#c0d8ff;padding:14px 20px}
  .btn-ghost:hover{background:#151e38}

  .setup-checklist{max-width:540px;margin:0 auto}
  .setup-checklist h2{font-size:22px;margin:0 0 8px;color:#dbe7ff}
  .setup-checklist>p{color:var(--muted);font-size:13px;margin:0 0 24px;line-height:1.5}
  .setup-item{background:var(--panel);border:2px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px;transition:border-color .3s}
  .setup-item.done{border-color:var(--accent2)}
  .setup-item h3{margin:0 0 6px;font-size:16px;color:#dbe7ff;display:flex;align-items:center;gap:10px}
  .setup-item h3 .check{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);display:none;align-items:center;justify-content:center;transition:all .3s;flex-shrink:0;font-size:13px}
  .setup-item.done h3 .check{display:flex;background:var(--accent2);border-color:var(--accent2);color:#0b0f1e}
  .setup-item.dimmed{opacity:.4;pointer-events:none}
  .setup-item.completed-dim{opacity:.55;pointer-events:none}
  .setup-item .setup-desc{color:var(--muted);font-size:13px;margin:6px 0 14px;line-height:1.5}
  .setup-item .setup-steps{color:var(--muted);font-size:12px;margin:10px 0 0;padding:12px;background:rgba(0,0,0,.2);border-radius:8px;line-height:1.7;display:none}
  .setup-item .setup-steps.visible{display:block}
  .setup-item .btn-action{padding:10px 20px;font-size:13px;border-radius:10px;border:none;cursor:pointer;font-weight:600;transition:all .2s}
  .setup-item .btn-action.ext{background:linear-gradient(135deg,#4a8af5,#3672d9);color:#fff}
  .setup-item .btn-action.overlay{background:linear-gradient(135deg,#34d399,#059669);color:#fff}
  .setup-item .btn-action:disabled{opacity:.5;cursor:not-allowed}

  .ext-sub{margin-top:16px;padding:16px;background:rgba(0,0,0,.15);border-radius:10px;border-left:3px solid var(--accent);animation:fadeSlide .3s ease}
  @keyframes fadeSlide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .ext-sub-label{font-size:14px;font-weight:700;color:#dbe7ff;display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .ext-sub-num{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
  .ext-sub-img{width:100%;max-width:460px;border-radius:8px;border:1px solid #2a3a62;margin:10px 0}
  .ext-sub-desc{color:var(--muted);font-size:13px;margin-bottom:10px;line-height:1.6}
  .copy-field{display:flex;align-items:center;gap:8px;margin:8px 0;background:#0a1328;border:1px solid #2a3a62;border-radius:8px;padding:10px 12px;font-family:'Consolas','Courier New',monospace;font-size:13px;color:var(--accent);word-break:break-all}
  .copy-field code{flex:1;user-select:all}
  .copy-field .copy-btn{flex-shrink:0;background:none;border:1px solid #2a3a62;color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;transition:all .2s}
  .copy-field .copy-btn:hover{border-color:var(--accent);color:var(--accent)}
  .copy-field .copy-btn.copied{border-color:var(--accent2);color:var(--accent2)}
  .ext-next{margin-top:12px;padding:10px 20px;font-size:13px;border-radius:10px;border:none;cursor:pointer;font-weight:600;background:linear-gradient(135deg,#4a8af5,#3672d9);color:#fff;transition:all .2s}
  .ext-next:hover{box-shadow:0 4px 12px rgba(74,138,245,0.3)}

  .done-screen{text-align:center;padding:40px 0}
  .done-screen h2{font-size:26px;margin:0 0 12px;color:#34d399}
  .done-screen p{color:var(--muted);font-size:14px;max-width:440px;margin:8px auto;line-height:1.6}
  .checkmark{font-size:48px;margin-bottom:16px}

  .loader-dots{display:inline-flex;gap:6px;vertical-align:middle}
  .loader-dots span{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:dot-pulse 1.4s ease-in-out infinite}
  .loader-dots span:nth-child(2){animation-delay:.2s}
  .loader-dots span:nth-child(3){animation-delay:.4s}
  @keyframes dot-pulse{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.1)}}

  .status{font-size:13px;color:var(--muted);margin-top:12px;min-height:20px}
  .status.error{color:var(--danger)}
</style></head>
<body>
<div class="container">
  <div class="hero">
    <h1 id="heroTitle"></h1>
    <p id="heroSub"></p>
  </div>

  <div class="step-indicator">
    <div class="dot active" id="dot0"></div>
    <div class="dot" id="dot1"></div>
    <div class="dot" id="dot2"></div>
    <div class="dot" id="dot3"></div>
  </div>

  <!-- Step 1: Template Selection -->
  <div class="step active" id="step0">
    <div class="templates" id="templates"></div>
    <div class="nav">
      <div></div>
      <button class="btn btn-primary" id="nextStep1" disabled></button>
    </div>
  </div>

  <!-- Step 2: Custom Wishes -->
  <div class="step" id="step1">
    <div class="wishes-section">
      <label id="wishesLabel"></label>
      <p style="color:var(--muted);font-size:13px;margin-top:0;line-height:1.6" id="wishesHint"></p>
      <p style="color:#5a6d94;font-size:12px;margin:8px 0 4px;font-style:italic;line-height:1.5" id="wishesExamples"></p>
      <div class="wishes-composer">
        <button type="button" class="btn mic" id="onboard-mic" title="">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <textarea id="wishes"></textarea>
        <div class="wave-container" id="onboard-wave">
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div>
          <span class="rec-time" id="onboard-rec-time">0s</span>
          <button type="button" class="rec-stop" id="onboard-rec-stop"></button>
        </div>
      </div>
      <div class="mic-status" id="onboard-mic-status"></div>
    </div>
    <div class="nav" id="navStep2" style="display:none">
      <button class="btn btn-ghost" id="backStep2"></button>
      <button class="btn btn-primary" id="nextStep2"></button>
    </div>
    <div class="status" id="saveStatus"></div>
  </div>

  <!-- Step 3: Setup Checklist -->
  <div class="step" id="step2">
    <div class="setup-checklist">
      <h2 id="setupTitle"></h2>
      <p id="setupSub"></p>

      <div class="setup-item" id="setup-ext">
        <h3><span class="check"></span> <span id="extTitle"></span></h3>
        <div class="setup-desc" id="extDesc"></div>

        <div id="ext-wizard">
          <div class="ext-sub" id="ext-sub-0">
            <div class="ext-sub-label"><span class="ext-sub-num">1</span> <span id="extSub0Title"></span></div>
            <div class="ext-sub-desc" id="extSub0Desc"></div>
            <div class="copy-field">
              <code id="ext-url">chrome://extensions</code>
              <button type="button" class="copy-btn" data-copy="ext-url" id="copyBtn0"></button>
            </div>
            <button type="button" class="ext-next" id="btn-ext-n0"></button>
          </div>

          <div class="ext-sub" id="ext-sub-1" style="display:none">
            <div class="ext-sub-label"><span class="ext-sub-num">2</span> <span id="extSub1Title"></span></div>
            <div class="ext-sub-desc" id="extSub1Desc"></div>
            <button type="button" class="ext-next" id="btn-ext-n1"></button>
          </div>

          <div class="ext-sub" id="ext-sub-2" style="display:none">
            <div class="ext-sub-label"><span class="ext-sub-num">3</span> <span id="extSub2Title"></span></div>
            <div class="ext-sub-desc" id="extSub2Desc"></div>
            <div class="copy-field">
              <code id="ext-path"></code>
              <button type="button" class="copy-btn" data-copy="ext-path" id="copyBtn1"></button>
            </div>
            <button type="button" class="ext-next" id="btn-ext-n2"></button>
          </div>

          <div class="ext-sub" id="ext-sub-3" style="display:none">
            <div class="ext-sub-label" style="color:var(--accent2)"><span class="ext-sub-num" style="background:var(--accent2);color:#0b0f1e">&#10003;</span> <span id="extSub3Title"></span></div>
            <div class="ext-sub-desc" id="extSub3Desc"></div>
            <button type="button" class="ext-next" id="btn-ext-n3" style="background:linear-gradient(135deg,#34d399,#059669)"></button>
          </div>
        </div>
      </div>

      <div class="setup-item dimmed" id="setup-overlay">
        <h3><span class="check"></span> <span id="overlayTitle"></span></h3>
        <div class="setup-desc" id="overlayDesc"></div>
        <button type="button" class="btn-action overlay" id="btn-start-overlay"></button>
      </div>

      <div class="nav" id="navStep3" style="display:none">
        <button class="btn btn-ghost" id="backStep3"></button>
        <button class="btn btn-primary" id="nextStep3"></button>
      </div>
    </div>
  </div>

  <!-- Step 4: Done -->
  <div class="step" id="step3">
    <div class="done-screen">
      <div class="checkmark">&#10003;</div>
      <h2 id="doneTitle"></h2>
      <p id="doneSub1"></p>
      <p style="margin-top:16px" id="doneSub2"></p>
      <button class="btn btn-primary" id="closeBtn" style="margin-top:20px"></button>
    </div>
  </div>
</div>

<script>
const LANG=${langJson};
const T={
  de:{
    heroTitle:"Willkommen bei Spark",
    heroSub:"Dein persoenlicher Agent, der dich vor Ablenkung schuetzt und zu deinen Zielen fuehrt.",
    next:"Weiter",
    back:"Zurueck",
    wishesLabel:"Beschreibe dem Spark Companion, wie er dir helfen soll",
    wishesHint:"Spark kann Tabs schliessen, dich auf produktive Seiten zurueckfuehren, Pausen erinnern, bestimmte Seiten blockieren und vieles mehr. Beschreibe ganz genau, was du erwartest â€” umso mehr Feedback du gibst, umso besser wird er.",
    wishesExamples:'Beispiele: "Schliesse YouTube wenn ich laenger als 5 Min schaue" \u00b7 "Erinnere mich alle 45 Min an eine Pause" \u00b7 "Blockiere TikTok und Instagram komplett"',
    wishesPlaceholder:"Beschreibe deine Wuensche... oder nutze das Mikrofon.",
    micTitle:"Spracheingabe",
    micStopTitle:"Aufnahme stoppen",
    micReady:"Bereit.",
    micRecording:"Aufnahme...",
    micTranscribing:"Transkribiere...",
    micNoData:"Keine Audiodaten.",
    micTooShort:"Aufnahme zu kurz.",
    micNoSpeech:"Keine Sprache erkannt.",
    micNoMic:"Kein Mikrofon (HTTPS?).",
    micNoRecorder:"MediaRecorder fehlt.",
    micDenied:"Mikrofon verweigert.",
    micError:"Mikrofon: ",
    micRecError:"Aufnahme-Fehler.",
    setupTitle:"Fast geschafft â€” noch zwei Schritte",
    setupSub:"Damit Spark richtig funktioniert, aktiviere die Browser-Extension und den Overlay-Chatbot.",
    extTitle:"Browser-Extension installieren",
    extDesc:"Spark erkennt damit, welche Webseiten du besuchst, und kann dich bei Ablenkung zurueckfuehren.",
    extSub0Title:"Extensions-Seite oeffnen",
    extSub0Desc:"Oeffne einen neuen Tab in Chrome und gib folgende Adresse ein:",
    extSub1Title:"Entwicklermodus aktivieren",
    extSub1Desc:'Aktiviere den Schalter <strong>"Entwicklermodus"</strong> oben rechts auf der Extensions-Seite.',
    extSub2Title:"Entpackte Erweiterung laden",
    extSub2Desc:'Klicke oben links auf <strong>"Entpackte Erweiterung laden"</strong>.<br/>Im geoeffneten Dialog: kopiere den Pfad unten, fuege ihn in die <strong>Adressleiste oben</strong> ein (Ctrl+V), <strong>druecke Enter</strong> um in den Ordner zu navigieren, dann klicke auf den <strong>"extension"</strong>-Ordner und klicke <strong>"Ordner auswaehlen"</strong>.',
    extSub3Title:"Extension installiert!",
    extSub3Desc:"Du solltest jetzt die <strong>Spark Extension</strong> in deiner Extensions-Liste sehen. Falls nicht, gehe zurueck und pruefe die Schritte.",
    extDone:"Erledigt",
    copy:"Kopieren",
    copied:"Kopiert!",
    overlayTitle:"Overlay / Chatbot starten",
    overlayDesc:"Der Overlay-Chatbot zeigt dir Spark-Nachrichten direkt auf dem Bildschirm an â€” Motivation, Pausen-Erinnerungen und mehr.",
    overlayStart:"Overlay starten",
    overlayStarting:"Wird gestartet...",
    overlayStarted:"Gestartet \\u2713",
    overlayError:"Fehler â€” erneut versuchen",
    doneTitle:"Spark ist bereit!",
    doneSub1:"Dein Agent laeuft jetzt im Hintergrund. Er wird dich sanft zurueckfuehren, wenn du abdriftest, und dir helfen, fokussiert zu bleiben.",
    doneSub2:"Du kannst das Fenster jetzt schliessen und normal weiterarbeiten.",
    doneBtn:"Los geht's",
    saving:'Wird gespeichert <span class="loader-dots"><span></span><span></span><span></span></span>',
    saveError:"Fehler: ",
    loadError:"Fehler beim Laden der Vorlagen.",
    extPathLoading:"Wird geladen..."
  },
  en:{
    heroTitle:"Welcome to Spark",
    heroSub:"Your personal agent that protects you from distractions and guides you towards your goals.",
    next:"Next",
    back:"Back",
    wishesLabel:"Tell the Spark Companion how it should help you",
    wishesHint:"Spark can close tabs, redirect you to productive pages, remind you of breaks, block specific sites and much more. Describe exactly what you expect â€” the more feedback you give, the better it gets.",
    wishesExamples:'Examples: "Close YouTube if I watch for more than 5 min" \u00b7 "Remind me every 45 min to take a break" \u00b7 "Block TikTok and Instagram completely"',
    wishesPlaceholder:"Describe your wishes... or use the microphone.",
    micTitle:"Voice input",
    micStopTitle:"Stop recording",
    micReady:"Ready.",
    micRecording:"Recording...",
    micTranscribing:"Transcribing...",
    micNoData:"No audio data.",
    micTooShort:"Recording too short.",
    micNoSpeech:"No speech detected.",
    micNoMic:"No microphone (HTTPS?).",
    micNoRecorder:"MediaRecorder missing.",
    micDenied:"Microphone denied.",
    micError:"Microphone: ",
    micRecError:"Recording error.",
    setupTitle:"Almost done â€” two more steps",
    setupSub:"To make Spark work properly, activate the browser extension and the overlay chatbot.",
    extTitle:"Install browser extension",
    extDesc:"Spark uses this to detect which websites you visit and can redirect you when distracted.",
    extSub0Title:"Open extensions page",
    extSub0Desc:"Open a new tab in Chrome and enter the following address:",
    extSub1Title:"Enable developer mode",
    extSub1Desc:'Enable the <strong>"Developer mode"</strong> toggle in the top right of the extensions page.',
    extSub2Title:"Load unpacked extension",
    extSub2Desc:'Click <strong>"Load unpacked"</strong> in the top left.<br/>In the dialog: copy the path below, paste it into the <strong>address bar at the top</strong> (Ctrl+V), <strong>press Enter</strong> to navigate into the folder, then click the <strong>"extension"</strong> folder and click <strong>"Select Folder"</strong>.',
    extSub3Title:"Extension installed!",
    extSub3Desc:"You should now see the <strong>Spark Extension</strong> in your extensions list. If not, go back and check the steps.",
    extDone:"Done",
    copy:"Copy",
    copied:"Copied!",
    overlayTitle:"Start Overlay / Chatbot",
    overlayDesc:"The overlay chatbot shows Spark messages directly on your screen â€” motivation, break reminders and more.",
    overlayStart:"Start overlay",
    overlayStarting:"Starting...",
    overlayStarted:"Started \\u2713",
    overlayError:"Error â€” try again",
    doneTitle:"Spark is ready!",
    doneSub1:"Your agent is now running in the background. It will gently redirect you when you drift off and help you stay focused.",
    doneSub2:"You can close this window now and continue working.",
    doneBtn:"Let's go",
    saving:'Saving <span class="loader-dots"><span></span><span></span><span></span></span>',
    saveError:"Error: ",
    loadError:"Error loading templates.",
    extPathLoading:"Loading..."
  }
};
const t=T[LANG]||T.de;

const $=id=>document.getElementById(id);

// Apply translations
$('heroTitle').textContent=t.heroTitle;
$('heroSub').textContent=t.heroSub;
$('nextStep1').textContent=t.next;
$('wishesLabel').textContent=t.wishesLabel;
$('wishesHint').textContent=t.wishesHint;
$('wishesExamples').textContent=t.wishesExamples;
$('wishes').placeholder=t.wishesPlaceholder;
$('onboard-mic').title=t.micTitle;
$('onboard-rec-stop').title=t.micStopTitle;
$('onboard-mic-status').textContent=t.micReady;
$('backStep2').textContent=t.back;
$('nextStep2').textContent=t.next;
$('setupTitle').textContent=t.setupTitle;
$('setupSub').textContent=t.setupSub;
$('extTitle').textContent=t.extTitle;
$('extDesc').textContent=t.extDesc;
$('extSub0Title').textContent=t.extSub0Title;
$('extSub0Desc').textContent=t.extSub0Desc;
$('copyBtn0').textContent=t.copy;
$('btn-ext-n0').textContent=t.next;
$('extSub1Title').textContent=t.extSub1Title;
$('extSub1Desc').innerHTML=t.extSub1Desc;
$('btn-ext-n1').textContent=t.next;
$('extSub2Title').textContent=t.extSub2Title;
$('extSub2Desc').innerHTML=t.extSub2Desc;
$('copyBtn1').textContent=t.copy;
$('btn-ext-n2').textContent=t.next;
$('extSub3Title').textContent=t.extSub3Title;
$('extSub3Desc').innerHTML=t.extSub3Desc;
$('btn-ext-n3').textContent=t.extDone;
$('overlayTitle').textContent=t.overlayTitle;
$('overlayDesc').textContent=t.overlayDesc;
$('btn-start-overlay').textContent=t.overlayStart;
$('backStep3').textContent=t.back;
$('nextStep3').textContent=t.next;
$('doneTitle').textContent=t.doneTitle;
$('doneSub1').textContent=t.doneSub1;
$('doneSub2').textContent=t.doneSub2;
$('closeBtn').textContent=t.doneBtn;
$('ext-path').textContent=t.extPathLoading;

let currentStep=0;
let selectedTemplate=localStorage.getItem('spark-selected-template')||null;

const TOTAL_STEPS=4;
function setStep(n){
  for(let i=0;i<TOTAL_STEPS;i++){
    $('step'+i).classList.toggle('active',i===n);
    $('dot'+i).classList.toggle('active',i===n);
    $('dot'+i).classList.toggle('done',i<n);
  }
  currentStep=n;
  localStorage.setItem('spark-onboard-step',String(n));
}

async function loadTemplates(){
  try{
    const r=await fetch('/onboarding/templates');
    const data=await r.json();
    const el=$('templates');
    el.innerHTML='';
    (data.templates||[]).forEach(t=>{
      const div=document.createElement('div');
      div.className='tpl';
      div.dataset.id=t.id;
      const h=document.createElement('h3');
      h.textContent=t.name||t.id;
      div.appendChild(h);
      const desc=document.createElement('div');
      desc.className='desc';
      desc.textContent=t.description||'';
      div.appendChild(desc);
      const hl=document.createElement('div');
      hl.className='highlights';
      (t.highlights||[]).forEach(txt=>{
        const pill=document.createElement('span');
        pill.className='hl';
        pill.textContent=txt;
        hl.appendChild(pill);
      });
      div.appendChild(hl);
      div.onclick=()=>{
        document.querySelectorAll('.tpl').forEach(e=>e.classList.remove('selected'));
        div.classList.add('selected');
        selectedTemplate=t.id;
        localStorage.setItem('spark-selected-template',t.id);
        $('nextStep1').disabled=false;
      };
      el.appendChild(div);
    });
  }catch(e){
    $('templates').textContent=t.loadError;
  }
}

if(selectedTemplate) $('nextStep1').disabled=false;
$('nextStep1').onclick=()=>{ if(selectedTemplate) setStep(1); };
$('backStep2').onclick=()=>setStep(0);
$('nextStep2').onclick=()=>save();
$('backStep3').onclick=()=>setStep(1);

// Show/hide Step 2 nav based on textarea content
function updateStep2Nav(){
  const hasText=$('wishes').value.trim().length>0;
  $('navStep2').style.display=hasText?'flex':'none';
}
$('wishes').addEventListener('input',updateStep2Nav);
updateStep2Nav();
$('nextStep3').onclick=()=>setStep(3);
$('closeBtn').onclick=()=>{ ['spark-onboard-step','spark-selected-template','spark-template-saved'].forEach(k=>localStorage.removeItem(k)); window.close(); window.location.href='/debug/ui'; };

// --- Setup Checklist (Step 3) ---
let extDone=false, overlayDone=false;
function updateSetupItem(id, done){
  const el=$(id);
  if(el) el.classList.toggle('done', done);
}
function updateStep3State(){
  // Unlock overlay when ext is done
  if(extDone){
    $('setup-overlay').classList.remove('dimmed');
    $('setup-ext').classList.add('completed-dim');
  }
  // Show nav when both done
  $('navStep3').style.display=(extDone&&overlayDone)?'flex':'none';
}

function showExtSub(n){
  for(let i=0;i<4;i++){const el=$('ext-sub-'+i);if(el)el.style.display=i===n?'block':'none';}
}

(async function loadExtPath(){
  try{
    const r=await fetch('/desktop/ext-path');
    const d=await r.json();
    if(d.path) $('ext-path').textContent=d.path;
  }catch{}
})();

document.querySelectorAll('.copy-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const src=$(btn.getAttribute('data-copy'));
    if(!src) return;
    navigator.clipboard.writeText(src.textContent).then(()=>{
      btn.textContent=t.copied;
      btn.classList.add('copied');
      setTimeout(()=>{btn.textContent=t.copy;btn.classList.remove('copied');},2000);
    }).catch(()=>{
      const range=document.createRange();
      range.selectNodeContents(src);
      const sel=window.getSelection();
      sel.removeAllRanges();sel.addRange(range);
    });
  });
});

$('btn-ext-n0').onclick=()=>showExtSub(1);
$('btn-ext-n1').onclick=()=>showExtSub(2);
$('btn-ext-n2').onclick=()=>showExtSub(3);
$('btn-ext-n3').onclick=()=>{
  extDone=true;
  updateSetupItem('setup-ext', true);
  $('ext-wizard').style.display='none';
  updateStep3State();
};

$('btn-start-overlay').onclick=async()=>{
  $('btn-start-overlay').disabled=true;
  $('btn-start-overlay').textContent=t.overlayStarting;
  try{
    const r=await fetch('/desktop/start-overlay',{method:'POST'});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'failed');
    overlayDone=true;
    updateSetupItem('setup-overlay', true);
    $('btn-start-overlay').textContent=t.overlayStarted;
    updateStep3State();
  }catch(e){
    $('btn-start-overlay').textContent=t.overlayError;
    $('btn-start-overlay').disabled=false;
  }
};

let templateSaved=!!localStorage.getItem('spark-template-saved');
async function save(){
  if(templateSaved){ setStep(2); return; }
  const status=$('saveStatus');
  status.className='status';
  status.innerHTML=t.saving;
  $('nextStep2').disabled=true;
  try{
    const payload={templateId:selectedTemplate,customNotes:$('wishes').value.trim()};
    const r=await fetch('/onboarding/select',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok||data.error) throw new Error(data.error||'save_failed');
    templateSaved=true;
    localStorage.setItem('spark-template-saved','1');
    setStep(2);
  }catch(e){
    status.className='status error';
    status.textContent=t.saveError+String(e);
    $('nextStep2').disabled=false;
  }
}

// Mic / STT
(function(){
  const micBtn=$('onboard-mic'), wishes=$('wishes'), waveEl=$('onboard-wave'), recTimeEl=$('onboard-rec-time');
  const micStatus=$('onboard-mic-status');
  let recording=false, recStart=0, recTimer=null;
  let recorder=null, currentStream=null;
  function setMicStatus(txt, err){
    micStatus.className='mic-status'+(err?' err':'');
    micStatus.textContent=txt;
  }
  function showRec(){
    recording=true; micBtn.classList.add('recording');
    wishes.style.display='none'; waveEl.classList.add('active');
    recStart=Date.now(); recTimeEl.textContent='0s';
    recTimer=setInterval(()=>{recTimeEl.textContent=Math.floor((Date.now()-recStart)/1000)+'s';},500);
    setMicStatus(t.micRecording);
  }
  function hideRec(){
    recording=false; micBtn.classList.remove('recording');
    wishes.style.display=''; waveEl.classList.remove('active');
    if(recTimer){clearInterval(recTimer);recTimer=null;}
  }
  function releaseStream(){
    if(currentStream){currentStream.getTracks().forEach(t=>t.stop());currentStream=null;}
  }
  function toBase64(bytes){
    let bin='';
    for(let i=0;i<bytes.length;i+=0x8000)
      bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
    return btoa(bin);
  }
  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia){setMicStatus(t.micNoMic,true);return;}
    if(!window.MediaRecorder){setMicStatus(t.micNoRecorder,true);return;}
    try{
      releaseStream();
      currentStream=await navigator.mediaDevices.getUserMedia({
        audio:{
          echoCancellation:true,
          noiseSuppression:true,
          autoGainControl:true,
          sampleRate:{ideal:16000},
          channelCount:1
        }
      });
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ?'audio/webm;codecs=opus'
        :MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'';
      recorder=new MediaRecorder(currentStream,{
        ...(mime?{mimeType:mime}:{}),
        audioBitsPerSecond:64000
      });
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data);};
      recorder.onstop=async()=>{
        hideRec();
        releaseStream();
        if(!chunks.length){setMicStatus(t.micNoData,true);return;}
        micStatus.className='mic-status';
        micStatus.innerHTML=t.micTranscribing+' <span class="loader-dots"><span></span><span></span><span></span></span>';
        try{
          const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
          if(blob.size<500){setMicStatus(t.micTooShort,true);return;}
          const buf=new Uint8Array(await blob.arrayBuffer());
          const res=await fetch('/stt',{
            method:'POST', headers:{'content-type':'application/json'},
            body:JSON.stringify({audioBase64:toBase64(buf), mimeType:blob.type})
          });
          const data=await res.json();
          if(data.error){setMicStatus('STT: '+(data.error+'').slice(0,80),true);return;}
          const text=String(data.text||'').trim();
          if(text){
            wishes.value+=(wishes.value? '\\n':'')+text;
            setMicStatus(t.micReady);
            wishes.focus();
            updateStep2Nav();
          }else{
            setMicStatus(t.micNoSpeech,true);
          }
        }catch(e){
          console.error('[onboard:stt]',e);
          setMicStatus('STT: '+(e.message||e).toString().slice(0,60),true);
        }
      };
      recorder.onerror=e=>{console.error('[onboard:stt] rec error:',e);hideRec();releaseStream();setMicStatus(t.micRecError,true);};
      recorder.start();
      showRec();
    }catch(e){
      console.error('[onboard:stt]',e);
      releaseStream();
      setMicStatus(e.name==='NotAllowedError'?t.micDenied:t.micError+(e.message||e).toString().slice(0,60),true);
    }
  }
  micBtn.addEventListener('click',()=>{ recording?(recorder&&recorder.stop()):startRecording(); });
  $('onboard-rec-stop').addEventListener('click',()=>{ if(recording&&recorder) recorder.stop(); });
})();

loadTemplates();
</script></body></html>`;
}

