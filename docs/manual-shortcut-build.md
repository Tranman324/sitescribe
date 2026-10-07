# SiteScribe: building the iOS Shortcuts by hand

> **Two shortcuts.** Verified against matthewcassinelli.com/actions.
> Prefer `shortcuts/build_shortcuts.py`, which generates both shortcuts. This guide builds them by hand.
> Replace `<YOUR_WEBHOOK_TOKEN>` and `https://notes.example.com` with your own values.

---

## Before you start

1. **Create the pending folder:** Files app → Browse → iCloud Drive → Shortcuts → tap New Folder → name it `SiteScribe` → open it → tap New Folder → name it `pending`
   - Final path: `iCloud Drive / Shortcuts / SiteScribe / pending /`
2. Have the Shortcuts app open and ready

---

# SHORTCUT 1: SiteScribe (homescreen, quick recordings)

Open Shortcuts → tap **+** → rename to **SiteScribe**

## Actions 1–4: Identity

### Action 1 — Text
- 🔍 Search: `Text`
- Type in field: `you@example.com`

### Action 2 — Set Variable
- 🔍 Search: `Set Variable`
- Variable Name: `My Email`
- Value: should auto-fill with `Text` from Action 1. If not, tap Value → pick `Text`.

### Action 3 — Text
- 🔍 Search: `Text`
- Type: `Your Name`

### Action 4 — Set Variable
- 🔍 Search: `Set Variable`
- Variable Name: `My Name`
- Value: `Text` from Action 3

---

## Action 5: Main Menu

### Action 5 — Choose from Menu
- 🔍 Search: `Choose from Menu`
- Prompt: `What would you like to do?`
- Rename items:
  - Item 1: `🎙️ Record now`
  - Item 2: `📤 Upload saved recordings`
- Delete any extra default items (red ⊖)

---

## Actions 6–21: "🎙️ Record now" Branch

**Everything in this section goes INSIDE the "🎙️ Record now" section.**

### Action 6 — Get Network Details (Wi-Fi check FIRST)
- 🔍 Search: `Get Network Details`
- First dropdown: **Wi-Fi**
- Second dropdown: **Network Name**

### Action 7 — Set Variable
- Variable Name: `WiFiName`
- Value: `Network Name` (output of Action 6)

### Action 8 — Record Audio
- 🔍 Search: `Record Audio`
- Expand ▼:
  - Audio Quality: **Normal**
  - Start Recording: **On Tap**
  - Finish Recording: **On Tap**

### Action 9 — Set Variable
- Variable Name: `AudioFile`
- Value: `Recorded Audio` (output of Action 8)

### Action 10 — If (Wi-Fi check)
- 🔍 Search: `If`
- Input: tap → pick **WiFiName** variable
- Condition: **has any value**

This creates If / Otherwise / End If. Actions 11–17 go in "If". Actions 18–19 go in "Otherwise".

---

### ─── INSIDE "IF" (on Wi-Fi) ───

### Action 11 — Choose from Menu (photos)
- 🔍 Search: `Choose from Menu`
- Prompt: `Add photos of your notes?`
- Items: `📷 Take new` / `🖼️ From library` / `Skip`

#### Inside "📷 Take new":
### Action 12 — Take Photo
- 🔍 Search: `Take Photo`
- Number of Photos: **5**
- Camera: **Back**
- Show Camera Preview: **ON**

### Action 13 — Set Variable
- Variable Name: `NotePhotos`
- Value: `Photos` (output of Action 12)

#### Inside "🖼️ From library":
### Action 14 — Select Photos
- 🔍 Search: `Select Photos`
- Select Multiple: **ON**

### Action 15 — Set Variable
- Variable Name: `NotePhotos`
- Value: `Selected Photos` (output of Action 14)

#### Inside "Skip":
Nothing. Leave empty.

#### End photo menu.

### Action 16 — Ask for Input
- 🔍 Search: `Ask for Input`
- Prompt: `Anything specific you want called out in the notes? (Optional — leave blank to skip)`
- Input Type: **Text**
- Default Answer: (blank)

### Action 17a — Set Variable
- Variable Name: `Emphasis`
- Value: `Provided Input` (output of Action 16)

### Action 17b — Get Contents of URL
- 🔍 Search: `Get Contents of URL`
- URL: `https://notes.example.com/api/meeting-notes`
- Expand "Show More":
  - Method: **POST**
  - Headers: tap + → Key: `x-auth-token` / Value: `<YOUR_WEBHOOK_TOKEN>`
  - Request Body: **Form**
  - Fields (tap + Add new field for each):

| Key | Type | Value |
|---|---|---|
| `audio` | **File** | `AudioFile` variable |
| `photo[]` | **File** | `NotePhotos` variable |
| `sender_email` | **Text** | `My Email` variable |
| `sender_name` | **Text** | `My Name` variable |
| `emphasis` | **Text** | `Emphasis` variable |

⚠️ **audio and photo[] MUST be type File, not Text.** Look for a type selector when adding the field.

### Action 17c — Show Notification
- 🔍 Search: `Show Notification`
- Body: `✅ Sent! Email coming at ya!`
- Title: `SiteScribe`
- Play Sound: ON
- ⚠️ If body auto-fills with "Contents of URL", tap the blue chip → Clear → type the text.

---

### ─── INSIDE "OTHERWISE" (on cellular) ───

### Action 18 — Save File
- 🔍 Search: `Save File`
- File: tap → pick **AudioFile** variable
- Service: **iCloud Drive**
- Ask Where to Save: **OFF**
- Destination Path: `Shortcuts/SiteScribe/pending/`

### Action 19 — Show Notification
- Body: `📱 Saved to Files. Open SiteScribe on Wi-Fi to upload.`
- Title: `SiteScribe`
- Play Sound: ON

### End If (auto-closes)

---

## Actions 20–27: "📤 Upload saved recordings" Branch

**Everything here goes INSIDE the "📤 Upload saved recordings" section of the main menu (Action 5).**

### Action 20 — Get File from Folder
- 🔍 Search: `Get File`
- Service: **iCloud Drive**
- Show Document Picker: **OFF**
- File Path: `Shortcuts/SiteScribe/pending/`
- Select Multiple: **ON**

### Action 21 — Count
- 🔍 Search: `Count`
- Count: **Items**
- (Input auto-fills from Action 20)

### Action 22 — If
- Input: **Count** (output of Action 21)
- Condition: **is greater than** `0`

#### Inside "If" (has pending files):

### Action 23 — Repeat with Each
- 🔍 Search: `Repeat with Each`
- Input: tap → pick the file list from **Action 20**

#### Inside Repeat:

### Action 24 — Get Contents of URL
- URL: `https://notes.example.com/api/meeting-notes`
- Method: **POST**
- Headers: `x-auth-token` = `<YOUR_WEBHOOK_TOKEN>`
- Body: **Form**
- Fields:

| Key | Type | Value |
|---|---|---|
| `audio` | **File** | `Repeat Item` (current file in loop) |
| `sender_email` | **Text** | `My Email` variable |
| `sender_name` | **Text** | `My Name` variable |

(No photos/emphasis for pending uploads — just audio.)

#### End Repeat

### Action 25 — Delete Files
- 🔍 Search: `Delete Files`
- Input: files from **Action 20**
- Confirm Before Deleting: **OFF**

### Action 26 — Show Notification
- Body: `✅ All saved recordings uploaded!`
- Title: `SiteScribe`

#### Inside "Otherwise" (no pending files):

### Action 27 — Show Notification
- Body: `📭 No saved recordings to upload.`
- Title: `SiteScribe`

### End If
### End Main Menu

**SiteScribe is done. ~27 actions total.**

---

# SHORTCUT 2: SiteScribe Share (share sheet, for Voice Memos)

Open Shortcuts → tap **+** → rename to **SiteScribe Share**

## Configure Share Sheet

**Before adding actions:** tap the **ⓘ** or **⚙️** settings icon (top of editor) → find:
- **Show in Share Sheet:** ON
- **Share Sheet Types:** select **Audio** (deselect everything else — Images, URLs, etc.)

This makes the shortcut appear when you tap Share in Voice Memos.

---

## Actions 1–4: Identity (same as SiteScribe)

### Action 1 — Text → `you@example.com`
### Action 2 — Set Variable → `My Email`
### Action 3 — Text → `Your Name`
### Action 4 — Set Variable → `My Name`

---

## Action 5: Capture the shared audio

### Action 5 — Set Variable
- Variable Name: `AudioFile`
- Value: **Shortcut Input**
- (This is the audio file that was shared from Voice Memos. It's automatically available as "Shortcut Input" because the shortcut was triggered from the share sheet.)

---

## Actions 6–7: Wi-Fi Check

### Action 6 — Get Network Details
- Wi-Fi → Network Name

### Action 7 — Set Variable
- Variable Name: `WiFiName`
- Value: `Network Name`

---

## Action 8: If (Wi-Fi gate)

### Action 8 — If
- Input: **WiFiName**
- Condition: **has any value**

---

### ─── INSIDE "IF" (on Wi-Fi) ───

### Action 9 — Choose from Menu (photos)
- Prompt: `Add photos of your notes?`
- Items: `📷 Take new` / `🖼️ From library` / `Skip`
- (Same pattern as SiteScribe Actions 11–15 — Take Photo or Select Photos → Set Variable `NotePhotos`)

### Action 10 — Take Photo (inside "📷 Take new")
- Number: 5, Back, Camera Preview ON

### Action 11 — Set Variable → `NotePhotos`

### Action 12 — Select Photos (inside "🖼️ From library")
- Select Multiple: ON

### Action 13 — Set Variable → `NotePhotos`

### Action 14 — Ask for Input
- Prompt: `Anything specific you want called out in the notes? (Optional — leave blank to skip)`
- Type: Text

### Action 15 — Set Variable → `Emphasis`

### Action 16 — Get Contents of URL
- URL: `https://notes.example.com/api/meeting-notes`
- Method: **POST**
- Headers: `x-auth-token` = `<YOUR_WEBHOOK_TOKEN>`
- Body: **Form**
- Fields:

| Key | Type | Value |
|---|---|---|
| `audio` | **File** | `AudioFile` variable |
| `photo[]` | **File** | `NotePhotos` variable |
| `sender_email` | **Text** | `My Email` variable |
| `sender_name` | **Text** | `My Name` variable |
| `emphasis` | **Text** | `Emphasis` variable |

### Action 17 — Show Notification
- Body: `✅ Sent! Email coming at ya!`
- Title: `SiteScribe`

---

### ─── INSIDE "OTHERWISE" (on cellular) ───

### Action 18 — Save File
- File: **AudioFile** variable
- Service: iCloud Drive
- Ask Where to Save: **OFF**
- Path: `Shortcuts/SiteScribe/pending/`

### Action 19 — Show Notification
- Body: `📱 Saved to Files. Open SiteScribe on Wi-Fi to upload.`
- Title: `SiteScribe`

### End If

**SiteScribe Share is done. ~19 actions total.**

---

# Testing Checklist

### Test 1: SiteScribe on Wi-Fi (happy path)
1. Connect to Wi-Fi
2. Run SiteScribe → "🎙️ Record now"
3. Record 10s → Stop → "Skip" photos → blank emphasis
4. ✅ notification → check email in 2 min

### Test 2: SiteScribe on Cellular (save path)
1. Turn OFF Wi-Fi
2. Run SiteScribe → "🎙️ Record now"
3. Record 10s → Stop
4. 📱 "Saved" notification
5. Check Files → iCloud Drive → Shortcuts → SiteScribe → pending → file should be there

### Test 3: Upload saved recordings
1. Wi-Fi ON, pending file exists from Test 2
2. Run SiteScribe → "📤 Upload saved recordings"
3. ✅ notification → check email → pending folder now empty

### Test 4: SiteScribe Share from Voice Memos
1. Open Voice Memos → record something short → tap Done
2. Tap the recording → tap Share (⬆️ icon) → find **SiteScribe Share** in share sheet
3. Photos → Skip, emphasis → blank
4. ✅ notification → check email

### Test 5: Photos + emphasis (full flow)
1. Wi-Fi ON, SiteScribe → Record now
2. Record 10s → "📷 Take new" → snap a photo of handwritten notes → Done
3. Emphasis: "Focus on the budget numbers"
4. ✅ → email should have 📋 NOTES from photo + 🎤 audio + emphasis

---

# Team Distribution (later)

### Import Questions
For each shortcut (SiteScribe + SiteScribe Share):
1. ⚙️ Settings → Import Questions
2. Link Action 1 (email text) → prompt: `What's your work email?`
3. Link Action 3 (name text) → prompt: `What's your full name?`
4. Share → Copy iCloud Link → send to team

### What they do
1. Tap link → iOS prompts for email + name → installs shortcut
2. Run from home screen (SiteScribe) or share sheet (SiteScribe Share)
3. Done. Zero config after install.

---

# Troubleshooting

| Symptom | Fix |
|---|---|
| ✅ notification but no email | Add Quick Look between Get Contents of URL and Show Notification to see server response |
| `{"error":"Missing audio file"}` | `audio` field type is Text, not File. Delete + re-add as File type. |
| `{"error":"Invalid or missing auth token"}` | Check `x-auth-token` header value matches exactly |
| `{"error":"Invalid email format"}` | My Email variable has a typo |
| `{"error":"Too many requests"}` | Wait 1 minute and try again (rate limit: 10/min) |
| Share sheet doesn't show SiteScribe Share | Check shortcut settings: Show in Share Sheet: ON, types: Audio |
| Photos don't appear in email | `photo[]` field must be type File, not Text |
| Save File fails (pending folder) | Create the folder first: Files → iCloud Drive → Shortcuts → SiteScribe → pending |
| "No saved recordings to upload" | Pending folder is empty. Only shows files if a previous cellular save happened. |

---

# Quick Reference: Action Names

| What you need | Search for |
|---|---|
| Text | `Text` |
| Set Variable | `Set Variable` |
| Choose from Menu | `Choose from Menu` |
| Record Audio | `Record Audio` |
| Get Network Details | `Get Network Details` |
| If | `If` |
| Take Photo | `Take Photo` |
| Select Photos | `Select Photos` |
| Ask for Input | `Ask for Input` |
| Get Contents of URL | `Get Contents of URL` |
| Show Notification | `Show Notification` |
| Save File | `Save File` |
| Get File (from folder) | `Get File` |
| Count | `Count` |
| Repeat with Each | `Repeat with Each` |
| Delete Files | `Delete Files` |
