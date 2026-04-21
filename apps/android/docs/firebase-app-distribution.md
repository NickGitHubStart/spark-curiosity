# Firebase App Distribution (Android)

Diese Anleitung beschreibt, wie **interne Tester** die Spark-Android-App installieren und wie du **neue Builds** auslieferst — ohne Play Store und ohne laufend ablaufende Logins (wenn du den Service-Account wie unten einrichtest).

Ausführliche Einzelschritte und Alternativen (Firebase CLI, Token): siehe **`apps/android/firebase-setup.txt`**.

---

## Was du am Rechner brauchst

| Datei / Ort | Zweck |
|-------------|--------|
| `apps/android/app/google-services.json` | Von der Firebase Console für diese Android-App; **nicht** ins Repo committen (`.gitignore`). |
| `apps/android/firebase-app-distribution-sa.json` | Service-Account-Schlüssel für dauerhafte Uploads; **nicht** committen (`.gitignore`). |
| Tester-Gruppe **`SparkCuriosityAndroidTester`** | Muss in Firebase **App Distribution** existieren und **exakt** zu `groups` in `app/build.gradle.kts` passen (Alias, nicht nur Anzeigename). |

---

## Neues Firebase-Projekt / neue App (einmalig)

1. **Firebase Console:** Projekt anlegen oder wählen → Android-App hinzufügen.
2. **Paketname** muss mit `applicationId` / `namespace` in `app/build.gradle.kts` übereinstimmen (aktuell `com.sparkcuriosity.app`).
3. **`google-services.json`** herunterladen nach **`apps/android/app/google-services.json`**.
4. **App Distribution** in der Firebase Console öffnen → **Testers & Groups** → Gruppe mit Alias **`SparkCuriosityAndroidTester`** anlegen (oder denselben Alias wie in `app/build.gradle.kts`) → Tester-E-Mails einladen.
5. **Upload-Zugriff (empfohlen, dauerhaft):**  
   - Google Cloud SDK installieren, einmal `gcloud auth login`.  
   - Im Ordner `apps/android`: **`.\setup-firebase-app-distribution-sa.ps1`**  
   Das legt das Dienstkonto an, aktiviert die API und schreibt **`firebase-app-distribution-sa.json`**.  
   Neuen Schlüssel erzwingen: **`.\setup-firebase-app-distribution-sa.ps1 -ReplaceKey`**

Wenn du **ein anderes Google-Konto** für Firebase nutzt als für `gcloud`: Mit **demselben Konto**, das das Projekt verwalten darf, `gcloud auth login` ausführen. Die **`project_id`** in `google-services.json` muss zu genau diesem Projekt gehören.

---

## Ersten Build hochladen (und Tester informieren)

PowerShell:

```powershell
cd apps/android
.\upload-app-distribution.ps1
```

Das baut ein **Debug-APK** und lädt es zu **Firebase App Distribution** hoch. Gradle kann am Ende Links ausgeben (Console, Tester-Erfahrung).

**Tester:** erhalten in der Regel eine **E-Mail** von Firebase oder folgen einem **Einladungs-/Release-Link**. Zum Installieren wird oft die **Firebase App Tester**-App bzw. der geführte Download genutzt.

Manuell (gleiche Wirkung):

```powershell
.\gradlew.bat assembleDebug appDistributionUploadDebug
```

---

## Jede neue Version

1. Optional **`apps/android/appdistribution-release-notes.txt`** anpassen.
2. Sinnvoll: **`versionCode`** und **`versionName`** in `app/build.gradle.kts` (`defaultConfig`) erhöhen.
3. Wieder **`.\upload-app-distribution.ps1`** ausführen.

---

## Release-Build (AAB) statt Debug-APK

Für Play-ähnliche Release-Artefakte brauchst du **Release-Signing** (Keystore). Wenn das eingerichtet ist:

```powershell
.\gradlew.bat bundleRelease appDistributionUploadRelease
```

Für die ersten internen Tester reicht meist das **Debug-APK** über `upload-app-distribution.ps1`.

---

## Kurz-Checkliste vor jedem Upload

- [ ] `app/google-services.json` vorhanden  
- [ ] `firebase-app-distribution-sa.json` vorhanden (oder `FIREBASE_TOKEN` / `firebase login` — weniger dauerhaft)  
- [ ] Gruppe **`SparkCuriosityAndroidTester`** (Alias) in Firebase mit allen Tester-Mails  
- [ ] Optional: Release Notes + Versionsnummer aktualisiert  

---

## Fehlerbehebung

### `404` / „problem adding testers/groups“ / „Requested entity was not found“

Das betrifft fast immer die **Tester-Gruppe**, nicht den Upload selbst.

1. **Richtiges Firebase-Projekt:** In der Console dasselbe Projekt wählen wie in `google-services.json` (`project_id`).
2. **App Distribution einmal öffnen:** Menü **Build** (oder **Engage**) → **App Distribution** — ggf. Ersteinrichtung / Hinweise durchklicken.
3. **Gruppe wirklich anlegen:** Tab **Testers & Groups** → **Add group** (o. ä.).
   - Wichtig ist der **Gruppen-Alias** (nicht nur der Anzeigename): er muss **buchstabengetreu** mit Gradle übereinstimmen (aktuell **`SparkCuriosityAndroidTester`**).
4. **Mindestens eine E-Mail** in der Gruppe speichern (leere Gruppe kann je nach Setup Probleme machen).
5. Upload erneut: `.\upload-app-distribution.ps1`

Wenn du in der Console einen anderen Alias gewählt hast, in `app/build.gradle.kts` bei `firebaseAppDistribution { groups = "…" }` **denselben** Alias eintragen wie unter *Testers & Groups* in Firebase (Spalte „Alias“ / technischer Name).

**Alternative ohne Gruppe:** In `firebaseAppDistribution` kannst du statt `groups` **`testers`** setzen (kommagetrennte E-Mails). Dann brauchst du keine Gruppe — die Adressen landen aber im Repo, wenn du das committest (lokal ändern oder nur für Tests).

---

## Skripte (Referenz)

| Skript | Aufgabe |
|--------|---------|
| `setup-firebase-app-distribution-sa.ps1` | Service Account + JSON-Key + API (Windows, `gcloud`) |
| `upload-app-distribution.ps1` | Debug-Build bauen und zu App Distribution hochladen |

Gradle-Konfiguration: `app/build.gradle.kts` (`firebaseAppDistribution`, `groups`, `artifactType`).
