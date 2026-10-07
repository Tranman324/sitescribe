#!/usr/bin/env python3
"""
Build SiteScribe iOS Shortcuts programmatically.

Generates two .shortcut files:
  1. SiteScribe.shortcut — home screen launcher (record now / upload saved)
  2. SiteScribe Share.shortcut — share sheet for Voice Memos

Uses the iOS Shortcuts generator (ShortcutBuilder) with raw plist actions
for full control over variable references, form bodies, and flow control.

Configuration comes from the environment (never hardcode the token):
  SITESCRIBE_URL    e.g. https://notes.example.com/api/meeting-notes
  SITESCRIBE_TOKEN  must match WEBHOOK_TOKEN on the server

Usage: SITESCRIBE_URL=... SITESCRIBE_TOKEN=... python3 shortcuts/build_shortcuts.py [out_dir]
"""

import sys
import uuid
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
from generate_shortcut import ShortcutBuilder

# ============================================================================
# Plist helpers
# ============================================================================

def uid():
    """Generate a GroupingIdentifier UUID."""
    return str(uuid.uuid4()).upper()


def text_token(s):
    """Plain text token string — for literal text in plist parameters."""
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}


def var_text(name):
    """Variable reference inside a text token — for text form fields."""
    return {
        "Value": {
            "attachmentsByRange": {
                "{0, 1}": {"Type": "Variable", "VariableName": name}
            },
            "string": "\ufffc"
        },
        "WFSerializationType": "WFTextTokenString"
    }


def var_attach(name):
    """Variable attachment reference — for file inputs, get_variable, etc."""
    return {
        "Value": {"Type": "Variable", "VariableName": name},
        "WFSerializationType": "WFTextTokenAttachment"
    }


def dict_field(items):
    """Dictionary field value structure — for headers, form values."""
    return {
        "Value": {"WFDictionaryFieldValueItems": items},
        "WFSerializationType": "WFDictionaryFieldValue"
    }


# ============================================================================
# Constants
# ============================================================================

AUTH_TOKEN = os.environ.get("SITESCRIBE_TOKEN", "")
WEBHOOK_URL = os.environ.get("SITESCRIBE_URL", "")
PENDING_PATH = "Shortcuts/SiteScribe/pending/"


# ============================================================================
# Reusable plist structures
# ============================================================================

def webhook_headers():
    """Auth headers for the SiteScribe webhook."""
    return dict_field([{
        "WFItemType": 0,
        "WFKey": text_token("x-auth-token"),
        "WFValue": text_token(AUTH_TOKEN)
    }])


def full_form_body():
    """Form fields for full submission: audio + photos + identity + emphasis."""
    return dict_field([
        {"WFItemType": 0, "WFKey": text_token("audio"), "WFValue": var_attach("AudioFile")},
        {"WFItemType": 0, "WFKey": text_token("photo[]"), "WFValue": var_attach("NotePhotos")},
        {"WFItemType": 0, "WFKey": text_token("sender_email"), "WFValue": var_text("My Email")},
        {"WFItemType": 0, "WFKey": text_token("sender_name"), "WFValue": var_text("My Name")},
        {"WFItemType": 0, "WFKey": text_token("emphasis"), "WFValue": var_text("Emphasis")},
    ])


def audio_only_form_body():
    """Form fields for audio-only submission (pending upload, no photos/emphasis)."""
    return dict_field([
        {"WFItemType": 0, "WFKey": text_token("audio"), "WFValue": var_attach("Repeat Item")},
        {"WFItemType": 0, "WFKey": text_token("sender_email"), "WFValue": var_text("My Email")},
        {"WFItemType": 0, "WFKey": text_token("sender_name"), "WFValue": var_text("My Name")},
    ])


# ============================================================================
# Action shorthands
# ============================================================================

def a_comment(b, text):
    b.add_raw_action("is.workflow.actions.comment", {"WFCommentActionText": text})

def a_text(b, text, action_uuid=None):
    params = {"WFTextActionText": text_token(text)}
    if action_uuid:
        params["UUID"] = action_uuid
    b.add_raw_action("is.workflow.actions.gettext", params)

def a_set_var(b, name):
    b.add_raw_action("is.workflow.actions.setvariable", {"WFVariableName": name})

def a_get_var(b, name):
    b.add_raw_action("is.workflow.actions.getvariable", {"WFVariable": var_attach(name)})

def a_get_shortcut_input(b):
    """Get the Shortcut Input (share sheet input)."""
    b.add_raw_action("is.workflow.actions.getvariable", {
        "WFVariable": {
            "Value": {"Type": "ExtensionInput"},
            "WFSerializationType": "WFTextTokenAttachment"
        }
    })

def a_notification(b, body, title="SiteScribe"):
    b.add_raw_action("is.workflow.actions.notification", {
        "WFNotificationActionBody": body,
        "WFNotificationActionTitle": title,
        "WFNotificationActionSound": True,
    })

def a_alert(b, message, title="SiteScribe", show_cancel=False):
    b.add_raw_action("is.workflow.actions.alert", {
        "WFAlertActionMessage": message,
        "WFAlertActionTitle": title,
        "WFAlertActionCancelButtonShown": show_cancel,
    })

def a_ask_input(b, prompt, input_type="Text"):
    b.add_raw_action("is.workflow.actions.ask", {
        "WFAskActionPrompt": prompt,
        "WFInputType": input_type,
    })

def a_url(b, url):
    b.add_raw_action("is.workflow.actions.url", {"WFURLActionURL": url})

def a_nothing(b):
    b.add_raw_action("is.workflow.actions.nothing", {})

def a_stop(b):
    b.add_raw_action("is.workflow.actions.exit", {})

def a_wifi_name(b):
    """Get Wi-Fi network name."""
    b.add_raw_action("is.workflow.actions.getwifi", {})

def a_record_audio(b):
    b.add_raw_action("is.workflow.actions.recordaudio", {
        "WFRecordingStart": "On Tap",
        "WFRecordingEnd": "On Tap",
        "WFRecordingCompression": "Normal",
    })

def a_take_photo(b, count=5):
    b.add_raw_action("is.workflow.actions.takephoto", {
        "WFPhotoCount": count,
        "WFCameraCaptureDevice": "Back",
        "WFCameraCaptureShowPreview": True,
    })

def a_select_photos(b):
    b.add_raw_action("is.workflow.actions.selectphoto", {
        "WFSelectMultiplePhotos": True,
    })

def a_save_file(b, path):
    b.add_raw_action("is.workflow.actions.documentpicker.save", {
        "WFFileDestinationPath": path,
        "WFAskWhereToSave": False,
    })

def a_get_files(b, path):
    b.add_raw_action("is.workflow.actions.documentpicker.open", {
        "WFGetFilePath": path,
        "WFFilePickerMultiple": True,
        "WFShowFilePicker": False,
    })

def a_count(b):
    b.add_raw_action("is.workflow.actions.count", {"WFCountType": "Items"})

def a_delete_files(b):
    b.add_raw_action("is.workflow.actions.file.delete", {
        "WFShouldConfirmFileDeletion": False,
    })

def a_webhook_post(b, form_body):
    """URL action → Get Contents of URL with form POST."""
    a_url(b, WEBHOOK_URL)
    b.add_raw_action("is.workflow.actions.downloadurl", {
        "WFHTTPMethod": "POST",
        "WFHTTPHeaders": webhook_headers(),
        "WFHTTPBodyType": "Form",
        "WFHTTPBodyParameters": form_body,
    })


# ============================================================================
# Flow control helpers
# ============================================================================

def menu_start(b, gid, prompt, items):
    b.add_raw_action("is.workflow.actions.choosefrommenu", {
        "WFControlFlowMode": 0,
        "GroupingIdentifier": gid,
        "WFMenuPrompt": prompt,
        "WFMenuItems": items,
    })

def menu_item(b, gid):
    b.add_raw_action("is.workflow.actions.choosefrommenu", {
        "WFControlFlowMode": 1,
        "GroupingIdentifier": gid,
    })

def menu_end(b, gid):
    b.add_raw_action("is.workflow.actions.choosefrommenu", {
        "WFControlFlowMode": 2,
        "GroupingIdentifier": gid,
    })

def if_has_value(b, gid):
    """If pipeline has any value."""
    b.add_raw_action("is.workflow.actions.conditional", {
        "WFControlFlowMode": 0,
        "GroupingIdentifier": gid,
        "WFCondition": 100,
    })

def if_greater_than(b, gid, value):
    """If pipeline is greater than value."""
    b.add_raw_action("is.workflow.actions.conditional", {
        "WFControlFlowMode": 0,
        "GroupingIdentifier": gid,
        "WFCondition": 2,
        "WFNumberValue": value,
    })

def otherwise(b, gid):
    b.add_raw_action("is.workflow.actions.conditional", {
        "WFControlFlowMode": 1,
        "GroupingIdentifier": gid,
    })

def end_if(b, gid):
    b.add_raw_action("is.workflow.actions.conditional", {
        "WFControlFlowMode": 2,
        "GroupingIdentifier": gid,
    })

def repeat_each_start(b, gid):
    b.add_raw_action("is.workflow.actions.repeat.each", {
        "WFControlFlowMode": 0,
        "GroupingIdentifier": gid,
    })

def repeat_each_end(b, gid):
    b.add_raw_action("is.workflow.actions.repeat.each", {
        "WFControlFlowMode": 2,
        "GroupingIdentifier": gid,
    })


# ============================================================================
# Build: SiteScribe (home screen)
# ============================================================================

def build_sitescribe(output_path):
    """
    Main SiteScribe shortcut — launched from home screen or widget.
    
    Flow:
      Menu → Record now / Upload saved recordings
      Record now:
        1. Check Wi-Fi
        2. Record audio
        3. If on Wi-Fi: photos + emphasis + POST to webhook
        4. If cellular: save audio to iCloud for later
      Upload saved:
        1. Get pending files from iCloud
        2. POST each to webhook
        3. Delete after upload
    """
    email_uid = uid()
    name_uid = uid()

    b = ShortcutBuilder(icon_color="green", icon_glyph="camera")
    b.add_import_question("What's your work email?", email_uid, default="you@example.com")
    b.add_import_question("What's your full name?", name_uid, default="Your Name")

    # --- Documentation ---
    a_comment(b, (
        "SiteScribe: voice note capture for field teams.\n"
        "Trigger: Home screen / widget\n"
        "Dependencies: Wi-Fi for immediate upload; saves offline for later\n"
        f"Webhook: {WEBHOOK_URL}\n"
        "Permissions: Microphone, Camera, Files (iCloud Drive)"
    ))

    # --- Identity (linked to Import Questions) ---
    a_text(b, "you@example.com", action_uuid=email_uid)
    a_set_var(b, "My Email")
    a_text(b, "Your Name", action_uuid=name_uid)
    a_set_var(b, "My Name")

    # --- Main Menu ---
    main_gid = uid()
    menu_start(b, main_gid, "What would you like to do?",
               ["🎙️ Record now", "📤 Upload saved recordings"])

    # ═══════════════════════════════════════════
    # Branch 1: Record now
    # ═══════════════════════════════════════════
    menu_item(b, main_gid)

    # Check Wi-Fi first (before recording, so we know the save path)
    a_wifi_name(b)
    a_set_var(b, "WiFiName")

    # Record audio
    a_record_audio(b)
    a_set_var(b, "AudioFile")

    # Get WiFiName back into pipeline for the If check
    a_get_var(b, "WiFiName")

    wifi_gid = uid()
    if_has_value(b, wifi_gid)

    # ─── ON WI-FI: full capture + upload ───

    # Photo menu
    photo_gid = uid()
    menu_start(b, photo_gid, "Add photos of your notes?",
               ["📷 Take new", "🖼️ From library", "Skip"])

    # Photo option 1: Take new
    menu_item(b, photo_gid)
    a_take_photo(b, 5)
    a_set_var(b, "NotePhotos")

    # Photo option 2: From library
    menu_item(b, photo_gid)
    a_select_photos(b)
    a_set_var(b, "NotePhotos")

    # Photo option 3: Skip
    menu_item(b, photo_gid)
    a_nothing(b)

    menu_end(b, photo_gid)

    # Emphasis (optional)
    a_ask_input(b, "Anything specific you want called out in the notes? (Optional — leave blank to skip)")
    a_set_var(b, "Emphasis")

    # POST to webhook
    a_webhook_post(b, full_form_body())

    # Success notification
    a_notification(b, "✅ Sent! Email coming at ya!")

    # ─── CELLULAR: save for later ───
    otherwise(b, wifi_gid)

    a_get_var(b, "AudioFile")
    a_save_file(b, PENDING_PATH)
    a_notification(b, "📱 Saved to Files. Open SiteScribe on Wi-Fi to upload.")

    end_if(b, wifi_gid)

    # ═══════════════════════════════════════════
    # Branch 2: Upload saved recordings
    # ═══════════════════════════════════════════
    menu_item(b, main_gid)

    a_get_files(b, PENDING_PATH)
    a_set_var(b, "pendingFiles")
    a_count(b)

    count_gid = uid()
    if_greater_than(b, count_gid, 0)

    # Upload each pending file
    a_get_var(b, "pendingFiles")

    repeat_gid = uid()
    repeat_each_start(b, repeat_gid)

    # POST current file (audio only, no photos/emphasis for pending uploads)
    a_webhook_post(b, audio_only_form_body())

    repeat_each_end(b, repeat_gid)

    # Clean up pending files
    a_get_var(b, "pendingFiles")
    a_delete_files(b)
    a_notification(b, "✅ All saved recordings uploaded!")

    otherwise(b, count_gid)
    a_notification(b, "📭 No saved recordings to upload.")

    end_if(b, count_gid)

    # End main menu
    menu_end(b, main_gid)

    # Save
    result = b.save(output_path)
    print(f"✅ SiteScribe saved: {result} ({result.stat().st_size} bytes)")
    return result


# ============================================================================
# Build: SiteScribe Share (share sheet)
# ============================================================================

def build_sitescribe_share(output_path):
    """
    SiteScribe Share — triggered from Voice Memos share sheet.
    
    Flow:
      1. Capture shared audio from share sheet
      2. Validate input
      3. If on Wi-Fi: photos + emphasis + POST to webhook
      4. If cellular: save audio to iCloud for later
    """
    email_uid = uid()
    name_uid = uid()

    b = ShortcutBuilder(icon_color="teal", icon_glyph="share")
    b.add_share_sheet()
    # Accept audio and generic files from share sheet
    b.input_classes = ["WFGenericFileContentItem", "WFAVAssetContentItem"]
    b.has_input_variables = True
    b.add_import_question("What's your work email?", email_uid, default="you@example.com")
    b.add_import_question("What's your full name?", name_uid, default="Your Name")

    # --- Documentation ---
    a_comment(b, (
        "SiteScribe Share: send voice memos to SiteScribe.\n"
        "Trigger: Share Sheet (audio files, e.g. from Voice Memos)\n"
        "Dependencies: Wi-Fi for immediate upload; saves offline for later\n"
        f"Webhook: {WEBHOOK_URL}\n"
        "Permissions: Camera (for photos), Files (iCloud Drive)"
    ))

    # --- Identity (linked to Import Questions) ---
    a_text(b, "you@example.com", action_uuid=email_uid)
    a_set_var(b, "My Email")
    a_text(b, "Your Name", action_uuid=name_uid)
    a_set_var(b, "My Name")

    # --- Input Validation ---
    # Get the shared audio from the share sheet
    a_get_shortcut_input(b)
    a_set_var(b, "AudioFile")

    # Validate: was audio actually shared?
    a_get_var(b, "AudioFile")
    validate_gid = uid()
    if_has_value(b, validate_gid)

    # Audio is valid — proceed

    # --- Wi-Fi Check ---
    a_wifi_name(b)
    a_set_var(b, "WiFiName")

    a_get_var(b, "WiFiName")
    wifi_gid = uid()
    if_has_value(b, wifi_gid)

    # ─── ON WI-FI: full capture + upload ───

    # Photo menu
    photo_gid = uid()
    menu_start(b, photo_gid, "Add photos of your notes?",
               ["📷 Take new", "🖼️ From library", "Skip"])

    menu_item(b, photo_gid)  # Take new
    a_take_photo(b, 5)
    a_set_var(b, "NotePhotos")

    menu_item(b, photo_gid)  # From library
    a_select_photos(b)
    a_set_var(b, "NotePhotos")

    menu_item(b, photo_gid)  # Skip
    a_nothing(b)

    menu_end(b, photo_gid)

    # Emphasis (optional)
    a_ask_input(b, "Anything specific you want called out in the notes? (Optional — leave blank to skip)")
    a_set_var(b, "Emphasis")

    # POST to webhook
    a_webhook_post(b, full_form_body())

    # Success notification
    a_notification(b, "✅ Sent! Email coming at ya!")

    # ─── CELLULAR: save for later ───
    otherwise(b, wifi_gid)

    a_get_var(b, "AudioFile")
    a_save_file(b, PENDING_PATH)
    a_notification(b, "📱 Saved to Files. Open SiteScribe on Wi-Fi to upload.")

    end_if(b, wifi_gid)

    # --- Input validation: no audio shared ---
    otherwise(b, validate_gid)
    a_alert(b, "No audio file was shared. Use the Share button in Voice Memos to send a recording.", "No Audio")
    a_stop(b)

    end_if(b, validate_gid)

    # Save
    result = b.save(output_path)
    print(f"✅ SiteScribe Share saved: {result} ({result.stat().st_size} bytes)")
    return result


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    if not AUTH_TOKEN or not WEBHOOK_URL:
        sys.exit("Set SITESCRIBE_URL and SITESCRIBE_TOKEN first (see docstring).")
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "dist"
    os.makedirs(out_dir, exist_ok=True)

    build_sitescribe(f"{out_dir}/SiteScribe.shortcut")
    build_sitescribe_share(f"{out_dir}/SiteScribe-Share.shortcut")

    print(f"\nBoth shortcuts generated in {out_dir}/")
    print("Send to iOS device → tap to import → test on device.")
