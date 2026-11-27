# Scan – persönliche Dokumentenscanner-App

Eine Web-App (PWA), die du auf Android wie eine normale App installierst:

1. **Aufnehmen** – eingebaute Kamera (bleibt in der App, mit Licht-Schalter) oder Galerie, mehrere Seiten pro Dokument
2. **Ecken erkennen** – OpenCV findet das Blatt; mit der Lupe kannst du die Ecken nachziehen
3. **Entzerren** – perspektivisch gerade gerichtet und auf A4 gebracht (einstellbar: immer A4 / automatisch / Originalproportion)
4. **Auto-Filter** – erkennt Farbe; reine Textseiten → Schwarz-Weiß, farbige → Farbe. Der Hintergrund wird jeweils herausgerechnet, damit das Papier reinweiß ist und kein Grauschleier bleibt. Manuell: Farbe, Graustufen, S/W, Original
5. **Texterkennung** (Tesseract, Deutsch + Englisch, läuft auf dem Handy)
6. **Analyse** – Datum, Dokumentart, Absender, Betreff und Themenordner. Wahlweise per **KI direkt auf dem Handy** (Einstellungen → KI-Analyse; kleines Sprachmodell über WebGPU, der Text verlässt das Gerät nicht) oder per Stichwortregeln
7. **Papierformat** – Seitenverhältnis wird aus der Perspektive berechnet, die Größe (A4, A5, A6, Letter, DIN lang …) über die Schriftgröße geschätzt; im Ablegen-Schritt änderbar
8. **PDF** – durchsuchbar (unsichtbare Textebene), Name z. B. `2026-11-03_Rechnung_Telekom_Mobilfunk-November.pdf`
9. **Ablage** – lokal in der App und automatisch in OneDrive unter `Scans/<Ordner>/`

Die Bilder und Texte verlassen das Handy nur beim Upload in dein eigenes OneDrive.

---

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. App hosten (kostenlos über GitHub Pages)

Kamera, Offline-Modus und Microsoft-Anmeldung brauchen eine HTTPS-Adresse.

1. Auf github.com ein neues Repository anlegen, z. B. `scan` (öffentlich oder privat mit Pages-fähigem Plan).
2. Alle Dateien aus diesem Ordner hochladen: `index.html`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`.
3. *Settings → Pages → Source: Deploy from a branch → main / (root)* → speichern.
4. Nach ca. einer Minute läuft die App unter `https://<dein-name>.github.io/scan/`.

Jeder andere HTTPS-Webspace funktioniert genauso.

### 2. OneDrive-Zugang registrieren (Azure)

1. Unter https://portal.azure.com mit deinem Microsoft-Konto anmelden. Falls nötig, legst du dabei ein kostenloses Konto an.
2. **Microsoft Entra ID → App-Registrierungen → Neue Registrierung**
   - Name: `Scan`
   - Unterstützte Kontotypen: *Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten*
   - Umleitungs-URI: Plattform **Single-Page-Anwendung (SPA)**, URI = **genau** deine App-Adresse, z. B. `https://<dein-name>.github.io/scan/`. Die App zeigt diese Adresse in den Einstellungen mit einem Kopieren-Button an.
3. Nach dem Anlegen die **Anwendungs-ID (Client-ID)** kopieren.
4. *API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen*: `Files.ReadWrite`, `User.Read`, `offline_access` (meist ist `User.Read` schon da).

### 3. Auf dem Handy

1. Die App-Adresse in **Chrome** öffnen.
2. Zahnrad → Client-ID einfügen → **Verbinden** → mit dem Microsoft-Konto anmelden und zustimmen.
3. Chrome-Menü → **App installieren** bzw. **Zum Startbildschirm hinzufügen**.

Beim ersten Scan lädt die App einmalig die Bildverarbeitung (ca. 10 MB) und die deutschen Texterkennungsdaten. Danach läuft alles außer dem Upload offline.

---

## Bedienung

- **Dokument scannen** öffnet die Kamera. Danach prüfst du die Ecken (abschaltbar) → *Übernehmen*.
- In der Seitenansicht kannst du den Filter wechseln, drehen, Ecken neu setzen, Seiten löschen oder mit **+ Seite** weitere hinzufügen.
- **Fertig** startet die Texterkennung. Danach siehst du den Vorschlag für Namen, Ordner, Datum, Art und Absender. Alles ist änderbar; der Name passt sich an, solange du ihn nicht selbst überschreibst.
- **Lernen:** Wenn du bei einem Absender den Ordner änderst, merkt sich die App das und legt künftige Briefe dieses Absenders dort ab.
- **Ordner und Stichwörter** stehen in den Einstellungen als einfache Liste (`Ordner: wort, wort`). Unterordner gehen mit `/`, z. B. `Finanzen/Bank: iban, kontoauszug`.
- Ohne Netz werden Scans gespeichert und hochgeladen, sobald du wieder online bist. Mit **Jetzt hochladen** geht es auch manuell.
- Tippen auf einen Scan: Teilen, Herunterladen, in OneDrive öffnen, erneut hochladen, löschen.

## Wenn etwas hakt

Einstellungen → **Protokoll** zeigt, was die App zuletzt getan hat (inkl. Fehlermeldungen und Laufzeiten). „Protokoll kopieren“ und an Claude schicken.

## Grenzen, die du kennen solltest

- **Anmeldung:** Microsoft lässt reine Web-Apps (SPA) nur 24 Stunden ohne erneute Anmeldung zu. Danach erscheint ein Hinweis *Neu verbinden*. Ein Tipp genügt; meist ist kein Passwort nötig, weil Chrome eingeloggt bleibt. Bis dahin werden Scans lokal gesammelt.
- **KI auf dem Handy:** braucht eine WebGPU-fähige Grafik (eher neuere Mittel- und Oberklasse-Handys). Das Modell (0,3–1,8 GB) wird einmalig von Hugging Face geladen; „Modell laden und testen“ in den Einstellungen zeigt, ob und wie schnell es läuft. Klappt es nicht, nutzt die App automatisch die Regeln.
- **Analyse ohne KI:** Die Zuordnung beruht auf Stichwörtern, einer Liste bekannter Absender (Telekom, Sparkasse, AOK, Finanzamt …) und Firmenendungen (GmbH, AG …). Bei ungewöhnlichen Dokumenten landet ein Scan in „Sonstiges“ oder bekommt einen falschen Absender. Das korrigierst du im Ablegen-Schritt; die Korrektur wird gelernt.
- **Bilderkennung:** Auf dem Gerät erkennt die App, ob eine Seite farbige Inhalte (Fotos, Logos, Stempel) hat, und wählt danach den Filter. Logos oder Bildinhalte erkennt sie nicht.
- **Handschrift** erkennt Tesseract kaum.
- Die Texterkennung braucht je nach Handy 3–10 Sekunden pro Seite.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die komplette App (Oberfläche, Bildverarbeitung, Analyse, PDF, OneDrive) |
| `cv-worker.js` | Bildverarbeitung (OpenCV) im Hintergrund-Thread |
| `llm-worker.js` | Sprachmodell (WebLLM) im Hintergrund-Thread |
| `sw.js` | Offline-Cache für App und Bibliotheken |
| `manifest.webmanifest`, `icon*` | Installierbarkeit als Android-App |

Verwendete Bibliotheken, zur Laufzeit von CDNs geladen und danach gecacht: OpenCV.js 4.10, Tesseract.js 5.1.1, jsPDF 2.5.2, WebLLM 0.2.87 mit Qwen2.5-Instruct. Die Anmeldung bei OneDrive läuft über OAuth 2.0 mit PKCE direkt gegen Microsoft, ohne Zusatzbibliothek.
