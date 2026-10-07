#!/usr/bin/env python3
"""
iOS Shortcuts Generator v2.0 — builds valid .shortcut files using plistlib.

Complete rewrite that matches Apple's real .shortcut plist serialization format,
including the WFSerializationType value-encoding layer, magic-variable UUID chaining,
interpolated text, dictionary field values, and proper control-flow blocks.

IMPORTANT: iOS 15+ requires shortcuts to be signed before import.
This generator produces UNSIGNED .shortcut files. Sign on macOS with:
    shortcuts sign -i unsigned.shortcut -o signed.shortcut
Signing requires macOS Monterey+ (the `shortcuts` CLI ships with the OS).

Usage:
    python3 generate_shortcut.py <definition.json> [output.shortcut]

    Or import as a library:
        from generate_shortcut import ShortcutBuilder
        builder = ShortcutBuilder()
        handle = builder.add_action("text", text="Hello!")
        builder.save("my-shortcut.shortcut")

BREAKING CHANGES from v1.0:
    - add_action() now returns an ActionHandle (was ShortcutBuilder for chaining)
    - "if" action requires input= (ref_variable/ref_output/ref_extension_input)
    - "set_variable" requires input= (the value to store)
    - "menu" is now a block: menu() → menu_case() per branch → end_menu()
    - WFCondition must be an integer (builder accepts friendly string names)
    - "get_url" supports WFURL directly (no separate url action needed for POST)
    - Dict params (headers, form_values, json_values) use WFDictionaryFieldValue encoding
    - Icon color map corrected (old map had wrong color assignments)
    - Top-level metadata changed: no WFWorkflowName, min_version=900,
      client_version="4528.0.4.2", WFQuickActionSurfaces=[]
    - Default types changed to [] (was ["NCWidget", "WatchKit"])
    - Builder no longer takes name= (name comes from filename, not plist)
    - build_from_definition() JSON schema updated for new features

Python 3.10+ stdlib only. No third-party dependencies.
"""

import json
import plistlib
import sys
import uuid
from pathlib import Path


# =============================================================================
# Icon Constants
# =============================================================================
# Corrected color table — verified against real shortcuts and clean-shortcuts docs.
# Values are packed RGBA-8 integers.
ICON_COLORS = {
    "red": 4282601983,       # FF4351FF
    "dark_orange": 4251333119, # FD6631FF
    "orange": 4271458815,    # FE9949FF
    "yellow": 4292093695,    # FFD426FF — was mislabeled as green in v1
    "green": 431817727,      # 19BD03FF — was mislabeled as teal in v1
    "teal": 431817727,       # alias for green (Apple's "teal" renders as green)
    "light_blue": 1440408063, # 55DAE1FF
    "blue": 463140863,       # 1B9AF7FF
    "dark_blue": 946986751,  # 3871DEFF
    "purple": 3679049983,    # DB49D8FF
    "pink": 3980825855,      # ED4694FF
    "dark_pink": 3989222655, # EDC3BFFF
    "gray": 255,             # 000000FF
}

ICON_GLYPHS = {
    "shortcut": 61440, "globe": 59662, "gear": 59548, "bell": 59530,
    "camera": 59474, "clipboard": 61444, "document": 59493, "folder": 59508,
    "heart": 59458, "home": 59496, "link": 59654, "location": 59519,
    "lock": 59636, "mail": 59500, "message": 61440, "music": 59504,
    "phone": 59458, "photo": 59478, "play": 59481, "search": 59574,
    "share": 59505, "star": 59577, "timer": 59588, "wifi": 59498,
    "wrench": 59548, "bolt": 59459, "cart": 59496, "cloud": 59472,
    "microphone": 61592,
}

# =============================================================================
# Condition Constants (Bug #1 fix)
# =============================================================================
CONDITION_MAP = {
    "is_less_than": 0, "less_than": 0, "lt": 0,
    "is_greater_than": 2, "greater_than": 2, "gt": 2,
    "equals": 4, "equal": 4, "eq": 4,
    "does_not_equal": 5, "not_equal": 5, "neq": 5, "ne": 5,
    "contains": 99,
    "does_not_contain": 999, "not_contains": 999,
    "has_any_value": 100, "has_value": 100, "any_value": 100,
}

# =============================================================================
# Content Item Classes
# =============================================================================
CONTENT_CLASSES = {
    "text": "WFStringContentItem",
    "url": "WFURLContentItem",
    "image": "WFImageContentItem",
    "pdf": "WFPDFContentItem",
    "file": "WFGenericFileContentItem",
    "web_page": "WFWebPageContentItem",
    "rich_text": "WFRichTextContentItem",
    "phone": "WFPhoneNumberContentItem",
    "email": "WFEmailAddressContentItem",
    "date": "WFDateContentItem",
    "location": "WFLocationContentItem",
    "contact": "WFContactContentItem",
    "app_store_app": "WFAppStoreAppContentItem",
    "map_link": "WFMKMapItemContentItem",
    "safari_web_page": "WFSafariWebPageContentItem",
    "app": "WFAppContentItem",
    "av_asset": "WFAVAssetContentItem",
    "article": "WFArticleContentItem",
    "itunes": "WFiTunesProductContentItem",
}

# WFItemType values for dictionary field entries
DICT_ITEM_TYPE = {
    "text": 0, "string": 0,
    "dictionary": 1, "dict": 1,
    "array": 2, "list": 2,
    "number": 3, "int": 3, "float": 3,
    "boolean": 4, "bool": 4,
    "file": 5, "attachment": 5,
}


# =============================================================================
# Reference Helpers (Bug #2, #7 fix)
# =============================================================================

class ActionHandle:
    """Opaque handle returned by add_action, used for magic-variable chaining."""
    __slots__ = ("uuid", "output_name", "action_type")

    def __init__(self, action_uuid: str, output_name: str, action_type: str):
        self.uuid = action_uuid
        self.output_name = output_name
        self.action_type = action_type

    def __repr__(self):
        return f"ActionHandle(uuid={self.uuid!r}, output={self.output_name!r})"


def ref_output(handle: ActionHandle) -> dict:
    """Create an ActionOutput reference to a previous action's output.

    Used in set_variable input=, conditional input=, dict values, interpolation.
    """
    return {
        "Value": {
            "OutputUUID": handle.uuid,
            "Type": "ActionOutput",
            "OutputName": handle.output_name,
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def ref_variable(name: str) -> dict:
    """Create a Variable reference by name (for named variables set via set_variable).

    Used in conditional input=, dict values, interpolation.
    """
    return {
        "Value": {
            "VariableName": name,
            "Type": "Variable",
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def ref_extension_input() -> dict:
    """Create an ExtensionInput reference (the share-sheet input).

    Used in set_variable input= to capture the share-sheet payload.
    """
    return {
        "Value": {
            "Type": "ExtensionInput",
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def _make_variable_wfinput(ref: dict) -> dict:
    """Wrap a variable reference for use as WFInput on a conditional (Type: Variable wrapper)."""
    return {
        "Type": "Variable",
        "Variable": ref,
    }


# =============================================================================
# Serialization Helpers (Bug #3, #6 fix)
# =============================================================================

def serialize_text_token_string(value: str) -> dict:
    """Wrap a plain string as WFTextTokenString."""
    return {
        "Value": {"string": value},
        "WFSerializationType": "WFTextTokenString",
    }


def serialize_interpolated_text(segments: list) -> dict:
    """Build a WFTextTokenString with embedded variable references.

    segments: list of str and dict (ref_variable/ref_output results).
    Example: ["Hello, ", ref_variable("Name"), "!"]
    Returns a WFTextTokenString with U+FFFC markers and attachmentsByRange.
    """
    text_parts = []
    attachments = {}
    offset = 0  # UTF-16 code unit offset

    for seg in segments:
        if isinstance(seg, str):
            # Count UTF-16 code units
            offset += len(seg.encode("utf-16-le")) // 2
            text_parts.append(seg)
        elif isinstance(seg, dict):
            # Insert U+FFFC and record attachment
            text_parts.append("\ufffc")
            # Extract the inner Value from the ref_ helper result
            if "WFSerializationType" in seg and "Value" in seg:
                attachment = seg["Value"]
            else:
                attachment = seg
            attachments[f"{{{offset}, 1}}"] = attachment
            offset += 1  # U+FFFC is 1 UTF-16 code unit

    result = {"string": "".join(text_parts)}
    if attachments:
        result["attachmentsByRange"] = attachments

    return {
        "Value": result,
        "WFSerializationType": "WFTextTokenString",
    }


def serialize_dict_field_value(items: list[dict]) -> dict:
    """Build a WFDictionaryFieldValue from a list of field items.

    Each item: {
        "key": str,
        "value": str | dict (ref),  # for text items
        "type": "text" | "file" | "number" | "boolean" | "dictionary" | "array",
    }

    For type="file" (attachment), value should be a ref_variable() or ref_output() dict.
    For type="text" with a variable, value should be a list of segments (interpolated text)
    or a ref dict (will be wrapped as a single-variable interpolated text).
    """
    field_items = []
    for item in items:
        key = item["key"]
        value = item.get("value", "")
        item_type = DICT_ITEM_TYPE.get(item.get("type", "text"), 0)

        wf_key = serialize_text_token_string(key)

        if item_type == 5:  # file/attachment
            # Wrap as WFTokenAttachmentParameterState
            if isinstance(value, dict) and "WFSerializationType" in value:
                inner_ref = value
            else:
                inner_ref = ref_variable(value) if isinstance(value, str) else value
            wf_value = {
                "Value": inner_ref,
                "WFSerializationType": "WFTokenAttachmentParameterState",
            }
        elif isinstance(value, list):
            # Interpolated text segments
            wf_value = serialize_interpolated_text(value)
        elif isinstance(value, dict) and "WFSerializationType" in value:
            # Already a ref — wrap as single-variable interpolated text
            wf_value = serialize_interpolated_text([value])
        elif isinstance(value, dict) and "Value" in value and "WFSerializationType" in value:
            # Pre-built serialized value, pass through
            wf_value = value
        else:
            # Plain string
            wf_value = serialize_text_token_string(str(value))

        field_items.append({
            "WFKey": wf_key,
            "WFItemType": item_type,
            "WFValue": wf_value,
        })

    return {
        "Value": {"WFDictionaryFieldValueItems": field_items},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


# =============================================================================
# Default output names for common actions
# =============================================================================
DEFAULT_OUTPUT_NAMES = {
    "is.workflow.actions.gettext": "Text",
    "is.workflow.actions.getwifi": "Network Details",
    "is.workflow.actions.ask": "Ask for Input",
    "is.workflow.actions.takephoto": "Photo",
    "is.workflow.actions.selectphoto": "Photos",
    "is.workflow.actions.downloadurl": "Contents of URL",
    "is.workflow.actions.getclipboard": "Clipboard",
    "is.workflow.actions.date": "Date",
    "is.workflow.actions.getbatterylevel": "Battery Level",
    "is.workflow.actions.getdevicedetails": "Device Details",
    "is.workflow.actions.url": "URL",
    "is.workflow.actions.detect.dictionary": "Dictionary",
    "is.workflow.actions.dictionary": "Dictionary",
    "is.workflow.actions.getvalueforkey": "Dictionary Value",
    "is.workflow.actions.list": "List",
    "is.workflow.actions.count": "Count",
    "is.workflow.actions.format.date": "Formatted Date",
    "is.workflow.actions.notification": "Notification",
    "is.workflow.actions.choosefromlist": "Chosen Item",
    "is.workflow.actions.choosefrommenu": "Menu Result",
    "is.workflow.actions.conditional": "If Result",
    "is.workflow.actions.repeat.count": "Repeat Results",
    "is.workflow.actions.repeat.each": "Repeat Results",
    "is.workflow.actions.documentpicker.open": "File",
    "is.workflow.actions.alert": "Alert",
    "is.workflow.actions.showresult": "Result",
    "is.workflow.actions.nothing": "Nothing",
}


# =============================================================================
# Action Registry
# =============================================================================
# Each entry: "builder_name" -> {"id": "is.workflow.actions.xxx", "build": callable}
# The build callable receives (params_dict, builder_instance) and returns
# the WFWorkflowActionParameters dict. UUID is added separately.

def _build_text(p, _b):
    return {"WFTextActionText": p.get("text", "")}


def _build_set_variable(p, _b):
    result = {"WFVariableName": p["name"]}
    if "input" in p:
        result["WFInput"] = p["input"]
    return result


def _build_get_variable(p, _b):
    return {
        "WFVariable": {
            "Value": {"VariableName": p["name"], "Type": "Variable"},
            "WFSerializationType": "WFTextTokenAttachment",
        }
    }


def _build_ask_input(p, _b):
    result = {"WFAskActionPrompt": p.get("prompt", "Enter value")}
    if "input_type" in p:
        result["WFInputType"] = p["input_type"]
    if "default" in p:
        result["WFAskActionDefaultAnswer"] = p["default"]
    return result


def _build_alert(p, _b):
    return {
        "WFAlertActionMessage": p.get("message", ""),
        "WFAlertActionTitle": p.get("title", "Alert"),
        "WFAlertActionCancelButtonShown": p.get("show_cancel", True),
    }


def _build_show_result(p, _b):
    return {"Text": p.get("text", "")}


def _build_notification(p, _b):
    result = {"WFNotificationActionBody": p.get("body", "")}
    if "title" in p:
        result["WFNotificationActionTitle"] = p["title"]
    if "sound" in p:
        result["WFNotificationActionSound"] = p["sound"]
    return result


def _build_choose_from_list(p, _b):
    return {"WFChooseFromListActionPrompt": p.get("prompt", "Choose")}


def _build_url(p, _b):
    return {"WFURLActionURL": p["url"]}


def _build_open_url(p, _b):
    return {}


def _build_get_url(p, _b):
    result = {}
    if "url" in p:
        result["WFURL"] = p["url"]
    if "method" in p:
        result["WFHTTPMethod"] = p["method"]
    if "body_type" in p:
        result["WFHTTPBodyType"] = p["body_type"]
    if "headers" in p:
        if isinstance(p["headers"], list):
            result["WFHTTPHeaders"] = serialize_dict_field_value(p["headers"])
            result["ShowHeaders"] = True
        else:
            result["WFHTTPHeaders"] = p["headers"]
            result["ShowHeaders"] = True
    if "form_values" in p:
        if isinstance(p["form_values"], list):
            result["WFFormValues"] = serialize_dict_field_value(p["form_values"])
        else:
            result["WFFormValues"] = p["form_values"]
    if "json_values" in p:
        if isinstance(p["json_values"], list):
            result["WFJSONValues"] = serialize_dict_field_value(p["json_values"])
        else:
            result["WFJSONValues"] = p["json_values"]
    if "body" in p:
        result["WFHTTPBody"] = p["body"]
    if "request_body" in p:
        result["WFRequestVariable"] = p["request_body"]
    if "show_headers" in p:
        result["ShowHeaders"] = p["show_headers"]
    return result


def _build_get_clipboard(p, _b):
    return {}


def _build_set_clipboard(p, _b):
    result = {}
    if "local_only" in p:
        result["WFLocalOnly"] = p["local_only"]
    return result


def _build_if(p, b):
    condition = p.get("condition", "equals")
    if isinstance(condition, str):
        condition = CONDITION_MAP.get(condition.lower(), 4)

    result = {
        "WFControlFlowMode": 0,
        "WFCondition": condition,
    }

    if "input" in p:
        inp = p["input"]
        # If it's a ref_variable or ref_output, wrap it for conditional WFInput
        if isinstance(inp, dict) and inp.get("WFSerializationType") == "WFTextTokenAttachment":
            val = inp.get("Value", {})
            if val.get("Type") == "Variable":
                # Variable ref → wrap in Type: Variable
                result["WFInput"] = _make_variable_wfinput(inp)
            elif val.get("Type") == "ActionOutput":
                # ActionOutput ref → wrap in Type: Variable
                result["WFInput"] = _make_variable_wfinput(inp)
            elif val.get("Type") == "ExtensionInput":
                result["WFInput"] = _make_variable_wfinput(inp)
            else:
                result["WFInput"] = inp
        else:
            result["WFInput"] = inp

    if "value" in p:
        result["WFConditionalActionString"] = p["value"]

    # GroupingIdentifier is handled by the builder
    return result


def _build_otherwise(p, _b):
    return {"WFControlFlowMode": 1}


def _build_end_if(p, _b):
    return {"WFControlFlowMode": 2}


def _build_menu(p, b):
    return {
        "WFControlFlowMode": 0,
        "WFMenuPrompt": p.get("prompt", "Choose"),
        "WFMenuItems": p.get("items", []),
    }


def _build_menu_case(p, _b):
    return {
        "WFControlFlowMode": 1,
        "WFMenuItemTitle": p.get("title", ""),
    }


def _build_end_menu(p, _b):
    return {"WFControlFlowMode": 2}


def _build_repeat(p, _b):
    return {"WFRepeatCount": p.get("count", 1), "WFControlFlowMode": 0}


def _build_end_repeat(p, _b):
    return {"WFControlFlowMode": 2}


def _build_repeat_each(p, _b):
    result = {"WFControlFlowMode": 0}
    if "input" in p:
        result["WFInput"] = p["input"]
    return result


def _build_end_repeat_each(p, _b):
    return {"WFControlFlowMode": 2}


def _build_wait(p, _b):
    return {"WFDelayTime": p.get("seconds", 1)}


def _build_comment(p, _b):
    return {"WFCommentActionText": p.get("text", "")}


def _build_stop(p, _b):
    return {}


def _build_nothing(p, _b):
    return {}


def _build_run_shortcut(p, _b):
    return {"WFWorkflowName": p["name"]}


def _build_get_dictionary(p, _b):
    return {}


def _build_dictionary(p, _b):
    result = {}
    if "items" in p:
        if isinstance(p["items"], list):
            result["WFItems"] = serialize_dict_field_value(p["items"])
        else:
            result["WFItems"] = p["items"]
    return result


def _build_get_dict_value(p, _b):
    return {"WFDictionaryKey": p["key"]}


def _build_set_dict_value(p, _b):
    return {"WFDictionaryKey": p["key"], "WFDictionaryValue": p["value"]}


def _build_count(p, _b):
    return {"WFCountType": p.get("type", "Items")}


def _build_list(p, _b):
    return {"WFItems": p.get("items", [])}


def _build_date(p, _b):
    return {"WFDateActionMode": p.get("mode", "Current Date")}


def _build_format_date(p, _b):
    result = {}
    if "style" in p:
        result["WFDateFormatStyle"] = p["style"]
    if "format" in p:
        result["WFDateFormat"] = p["format"]
    return result


def _build_get_battery(p, _b):
    return {}


def _build_device_details(p, _b):
    return {"WFDeviceDetail": p.get("detail", "Device Name")}


def _build_set_brightness(p, _b):
    return {"WFBrightness": p.get("level", 0.5)}


def _build_set_volume(p, _b):
    return {"WFVolume": p.get("level", 0.5)}


def _build_share(p, _b):
    return {}


def _build_airdrop(p, _b):
    return {}


def _build_take_photo(p, _b):
    result = {}
    if "show_preview" in p:
        result["WFCameraCaptureShowPreview"] = p["show_preview"]
    if "photo_count" in p:
        result["WFPhotoCount"] = p["photo_count"]
    return result


def _build_select_photos(p, _b):
    result = {}
    if "multiple" in p:
        result["WFSelectMultiplePhotos"] = p["multiple"]
    if "picker_types" in p:
        result["WFPhotoPickerTypes"] = p["picker_types"]
    return result


def _build_save_to_album(p, _b):
    return {}


def _build_get_file(p, _b):
    return {"WFFilePickerMultiple": p.get("multiple", False)}


def _build_save_file(p, _b):
    result = {"WFAskWhereToSave": p.get("ask_where", True)}
    if "path" in p:
        result["WFFileDestinationPath"] = p["path"]
    return result


def _build_quick_look(p, _b):
    return {}


def _build_view_content_graph(p, _b):
    return {}


def _build_get_wifi(p, _b):
    return {}


def _build_raw(p, _b):
    return p.get("parameters", {})


ACTION_REGISTRY = {
    # --- Text & Variables ---
    "text": {"id": "is.workflow.actions.gettext", "build": _build_text},
    "set_variable": {"id": "is.workflow.actions.setvariable", "build": _build_set_variable},
    "get_variable": {"id": "is.workflow.actions.getvariable", "build": _build_get_variable},

    # --- User Interaction ---
    "ask_input": {"id": "is.workflow.actions.ask", "build": _build_ask_input},
    "alert": {"id": "is.workflow.actions.alert", "build": _build_alert},
    "show_result": {"id": "is.workflow.actions.showresult", "build": _build_show_result},
    "notification": {"id": "is.workflow.actions.notification", "build": _build_notification},
    "choose_from_list": {"id": "is.workflow.actions.choosefromlist", "build": _build_choose_from_list},

    # --- Menu (control-flow block) ---
    "menu": {"id": "is.workflow.actions.choosefrommenu", "build": _build_menu},
    "menu_case": {"id": "is.workflow.actions.choosefrommenu", "build": _build_menu_case},
    "end_menu": {"id": "is.workflow.actions.choosefrommenu", "build": _build_end_menu},

    # --- Web / API ---
    "url": {"id": "is.workflow.actions.url", "build": _build_url},
    "open_url": {"id": "is.workflow.actions.openurl", "build": _build_open_url},
    "get_url": {"id": "is.workflow.actions.downloadurl", "build": _build_get_url},

    # --- Clipboard ---
    "get_clipboard": {"id": "is.workflow.actions.getclipboard", "build": _build_get_clipboard},
    "set_clipboard": {"id": "is.workflow.actions.setclipboard", "build": _build_set_clipboard},

    # --- Control Flow ---
    "if": {"id": "is.workflow.actions.conditional", "build": _build_if},
    "otherwise": {"id": "is.workflow.actions.conditional", "build": _build_otherwise},
    "end_if": {"id": "is.workflow.actions.conditional", "build": _build_end_if},
    "repeat": {"id": "is.workflow.actions.repeat.count", "build": _build_repeat},
    "end_repeat": {"id": "is.workflow.actions.repeat.count", "build": _build_end_repeat},
    "repeat_each": {"id": "is.workflow.actions.repeat.each", "build": _build_repeat_each},
    "end_repeat_each": {"id": "is.workflow.actions.repeat.each", "build": _build_end_repeat_each},
    "wait": {"id": "is.workflow.actions.delay", "build": _build_wait},
    "comment": {"id": "is.workflow.actions.comment", "build": _build_comment},
    "stop": {"id": "is.workflow.actions.exit", "build": _build_stop},
    "nothing": {"id": "is.workflow.actions.nothing", "build": _build_nothing},

    # --- Run Other Shortcuts ---
    "run_shortcut": {"id": "is.workflow.actions.runworkflow", "build": _build_run_shortcut},

    # --- Data ---
    "get_dictionary": {"id": "is.workflow.actions.detect.dictionary", "build": _build_get_dictionary},
    "dictionary": {"id": "is.workflow.actions.dictionary", "build": _build_dictionary},
    "get_dictionary_value": {"id": "is.workflow.actions.getvalueforkey", "build": _build_get_dict_value},
    "set_dictionary_value": {"id": "is.workflow.actions.setvalueforkey", "build": _build_set_dict_value},
    "count": {"id": "is.workflow.actions.count", "build": _build_count},
    "list": {"id": "is.workflow.actions.list", "build": _build_list},

    # --- Date/Time ---
    "date": {"id": "is.workflow.actions.date", "build": _build_date},
    "format_date": {"id": "is.workflow.actions.format.date", "build": _build_format_date},

    # --- Device ---
    "get_battery_level": {"id": "is.workflow.actions.getbatterylevel", "build": _build_get_battery},
    "get_device_details": {"id": "is.workflow.actions.getdevicedetails", "build": _build_device_details},
    "set_brightness": {"id": "is.workflow.actions.setbrightness", "build": _build_set_brightness},
    "set_volume": {"id": "is.workflow.actions.setvolume", "build": _build_set_volume},

    # --- Sharing ---
    "share": {"id": "is.workflow.actions.share", "build": _build_share},
    "airdrop": {"id": "is.workflow.actions.airdropdocument", "build": _build_airdrop},

    # --- Photos ---
    "take_photo": {"id": "is.workflow.actions.takephoto", "build": _build_take_photo},
    "select_photos": {"id": "is.workflow.actions.selectphoto", "build": _build_select_photos},
    "save_to_photo_album": {"id": "is.workflow.actions.savetocameraroll", "build": _build_save_to_album},

    # --- Files ---
    "get_file": {"id": "is.workflow.actions.documentpicker.open", "build": _build_get_file},
    "save_file": {"id": "is.workflow.actions.documentpicker.save", "build": _build_save_file},

    # --- Debug ---
    "quick_look": {"id": "is.workflow.actions.previewdocument", "build": _build_quick_look},
    "view_content_graph": {"id": "is.workflow.actions.viewresult", "build": _build_view_content_graph},

    # --- Network ---
    "get_wifi": {"id": "is.workflow.actions.getwifi", "build": _build_get_wifi},

    # --- Raw (escape hatch) ---
    "raw": {"id": None, "build": _build_raw},
}


# =============================================================================
# ShortcutBuilder
# =============================================================================

class ShortcutBuilder:
    """Build an Apple Shortcut (.shortcut) file programmatically.

    Usage:
        builder = ShortcutBuilder()
        h = builder.add_action("text", text="Hello")
        builder.add_action("set_variable", name="greeting", input=ref_output(h))
        builder.save("greeting.shortcut")
    """

    def __init__(self, *,
                 icon_color: str | int = "blue",
                 icon_glyph: str | int = "shortcut",
                 min_version: int = 900,
                 client_version: str = "4528.0.4.2"):
        self.actions: list[dict] = []
        self.import_questions: list[dict] = []
        self.input_classes: list[str] = []
        self.output_classes: list[str] = []
        self._flow_stack: list[tuple[str, str]] = []  # (GroupingIdentifier, block_type)
        self.types: list[str] = []
        self.has_input_variables = False
        self.has_output_fallback = False

        if isinstance(icon_color, int):
            self.icon_color = icon_color
        else:
            self.icon_color = ICON_COLORS.get(icon_color, ICON_COLORS["blue"])

        if isinstance(icon_glyph, int):
            self.icon_glyph = icon_glyph
        else:
            self.icon_glyph = ICON_GLYPHS.get(icon_glyph, ICON_GLYPHS["shortcut"])

        self.min_version = min_version
        self.client_version = client_version

    def add_action(self, action_type: str, **params) -> ActionHandle:
        """Add an action by registry name with keyword params.

        Returns an ActionHandle for magic-variable chaining.
        """
        if action_type not in ACTION_REGISTRY:
            raise ValueError(f"Unknown action: {action_type!r}. Use 'raw' for custom actions.")

        entry = ACTION_REGISTRY[action_type]
        action_id = entry["id"]
        action_params = entry["build"](params, self)

        if action_type == "raw":
            action_id = params.get("identifier", "is.workflow.actions.nothing")

        # Generate UUID for output-producing actions (Bug #7)
        action_uuid = params.get("uuid", str(uuid.uuid4()).upper())
        output_name = DEFAULT_OUTPUT_NAMES.get(action_id, "Output")

        # Handle flow-control GroupingIdentifier management
        if action_type == "if":
            group_id = str(uuid.uuid4()).upper()
            action_params["GroupingIdentifier"] = group_id
            self._flow_stack.append((group_id, "if"))
        elif action_type == "otherwise":
            if self._flow_stack and self._flow_stack[-1][1] == "if":
                action_params["GroupingIdentifier"] = self._flow_stack[-1][0]
        elif action_type == "end_if":
            if self._flow_stack and self._flow_stack[-1][1] == "if":
                action_params["GroupingIdentifier"] = self._flow_stack[-1][0]
                self._flow_stack.pop()
        elif action_type == "menu":
            group_id = str(uuid.uuid4()).upper()
            action_params["GroupingIdentifier"] = group_id
            self._flow_stack.append((group_id, "menu"))
        elif action_type == "menu_case":
            if self._flow_stack and self._flow_stack[-1][1] == "menu":
                action_params["GroupingIdentifier"] = self._flow_stack[-1][0]
        elif action_type == "end_menu":
            if self._flow_stack and self._flow_stack[-1][1] == "menu":
                action_params["GroupingIdentifier"] = self._flow_stack[-1][0]
                self._flow_stack.pop()
        elif action_type == "repeat":
            group_id = str(uuid.uuid4()).upper()
            action_params["GroupingIdentifier"] = group_id
            self._flow_stack.append((group_id, "repeat"))
        elif action_type == "end_repeat":
            if self._flow_stack and self._flow_stack[-1][1] == "repeat":
                action_params["GroupingIdentifier"] = self._flow_stack[-1][0]
                self._flow_stack.pop()
        elif action_type == "repeat_each":
            group_id = str(uuid.uuid4()).upper()
            action_params["GroupingIdentifier"] = group_id
            self._flow_stack.append((group_id, "repeat_each"))
        elif action_type == "end_repeat_each":
            if self._flow_stack and self._flow_stack[-1][1] == "repeat_each":
                action_params["GroupingIdentifier"] = self._flow_stack[-1][0]
                self._flow_stack.pop()

        # Add UUID to action params (only for non-flow-control or end-of-block actions)
        # Most actions get a UUID. Flow control start/middle don't need one for output
        # but end-of-block actions do (they produce the block's output).
        # Ground truth: end_if and end_menu have UUIDs, start/middle conditionals don't.
        # Actually, looking at ground truth more carefully:
        # - text actions have UUID (output-producing)
        # - getwifi has UUID
        # - set_variable does NOT have UUID (it stores, doesn't produce)
        # - conditional mode=0 does NOT have UUID
        # - conditional mode=1 does NOT have UUID
        # - conditional mode=2 HAS UUID
        # - choosefrommenu mode=0 does NOT have UUID
        # - choosefrommenu mode=1 does NOT have UUID
        # - choosefrommenu mode=2 HAS UUID
        # - exit does NOT have UUID
        # - takephoto HAS UUID
        # - selectphoto HAS UUID
        # - ask HAS UUID
        # - downloadurl HAS UUID
        # - notification HAS UUID

        needs_uuid = True
        if action_type in ("set_variable", "stop", "comment"):
            needs_uuid = False
        elif action_type in ("if", "otherwise", "menu", "menu_case"):
            needs_uuid = False
        elif action_type in ("repeat",):
            needs_uuid = False  # start doesn't produce output

        if needs_uuid:
            action_params["UUID"] = action_uuid

        action = {
            "WFWorkflowActionIdentifier": action_id,
            "WFWorkflowActionParameters": action_params,
        }
        self.actions.append(action)

        return ActionHandle(action_uuid, output_name, action_type)

    def add_raw_action(self, identifier: str, parameters: dict | None = None) -> ActionHandle:
        """Add a raw action by WFWorkflow identifier."""
        params = parameters or {}
        action_uuid = params.get("UUID", str(uuid.uuid4()).upper())
        action = {
            "WFWorkflowActionIdentifier": identifier,
            "WFWorkflowActionParameters": params,
        }
        self.actions.append(action)
        output_name = DEFAULT_OUTPUT_NAMES.get(identifier, "Output")
        return ActionHandle(action_uuid, output_name, "raw")

    def add_import_question(self, prompt: str, variable: str,
                            qtype: str = "Text", default: str = "") -> "ShortcutBuilder":
        """Add a setup question shown during shortcut import."""
        self.import_questions.append({
            "WFWorkflowImportQuestionType": qtype,
            "WFWorkflowImportQuestionPrompt": prompt,
            "WFWorkflowImportQuestionDefaultValue": default,
            "WFWorkflowImportQuestionVariable": variable,
        })
        return self

    def set_input_types(self, *types: str) -> "ShortcutBuilder":
        """Set accepted input content types (text, url, image, app, av_asset, etc.)."""
        self.input_classes = [CONTENT_CLASSES.get(t, t) for t in types]
        self.has_input_variables = len(self.input_classes) > 0
        return self

    def set_output_types(self, *types: str) -> "ShortcutBuilder":
        """Set output content types."""
        self.output_classes = [CONTENT_CLASSES.get(t, t) for t in types]
        return self

    def set_types(self, *types: str) -> "ShortcutBuilder":
        """Set workflow types (ActionExtension, WFWorkflowTypeShowInSearch, NCWidget, WatchKit, etc.)."""
        self.types = list(types)
        return self

    def add_share_sheet(self) -> "ShortcutBuilder":
        """Enable this shortcut in the Share Sheet."""
        if "ActionExtension" not in self.types:
            self.types.append("ActionExtension")
        return self

    def build(self) -> dict:
        """Build the plist dictionary."""
        result = {
            "WFWorkflowMinimumClientVersionString": str(self.min_version),
            "WFWorkflowMinimumClientVersion": self.min_version,
            "WFWorkflowIcon": {
                "WFWorkflowIconStartColor": self.icon_color,
                "WFWorkflowIconGlyphNumber": self.icon_glyph,
            },
            "WFWorkflowClientVersion": self.client_version,
            "WFWorkflowActions": self.actions,
            "WFWorkflowHasOutputFallback": self.has_output_fallback,
            "WFWorkflowOutputContentItemClasses": self.output_classes,
            "WFWorkflowInputContentItemClasses": self.input_classes,
            "WFWorkflowImportQuestions": self.import_questions,
            "WFQuickActionSurfaces": [],
            "WFWorkflowTypes": self.types,
            "WFWorkflowHasShortcutInputVariables": self.has_input_variables,
        }
        return result

    def save(self, path: str) -> Path:
        """Save as binary plist .shortcut file."""
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "wb") as f:
            plistlib.dump(self.build(), f, fmt=plistlib.FMT_BINARY)
        return out

    def to_json(self) -> str:
        """Export the plist dict as JSON (for debugging)."""
        return json.dumps(self.build(), indent=2, default=str)

    def validate(self) -> list[str]:
        """Check for common issues. Returns list of warning strings (empty = clean)."""
        warnings = []
        if self._flow_stack:
            open_blocks = [f"{t}({g[:8]}...)" for g, t in self._flow_stack]
            warnings.append(f"Unclosed flow control blocks: {', '.join(open_blocks)}")
        if not self.actions:
            warnings.append("Shortcut has no actions")

        # Check for conditionals without WFInput
        for i, action in enumerate(self.actions):
            params = action.get("WFWorkflowActionParameters", {})
            ident = action.get("WFWorkflowActionIdentifier", "")
            if ident == "is.workflow.actions.conditional" and params.get("WFControlFlowMode") == 0:
                if "WFInput" not in params:
                    warnings.append(f"Action [{i}] conditional start has no WFInput — will test nothing")

        # Check for menu_case outside menu block
        menu_depth = 0
        for i, action in enumerate(self.actions):
            params = action.get("WFWorkflowActionParameters", {})
            ident = action.get("WFWorkflowActionIdentifier", "")
            if ident == "is.workflow.actions.choosefrommenu":
                mode = params.get("WFControlFlowMode")
                if mode == 0:
                    menu_depth += 1
                elif mode == 1:
                    if menu_depth == 0:
                        warnings.append(f"Action [{i}] menu_case outside a menu block")
                elif mode == 2:
                    menu_depth -= 1

        return warnings


# =============================================================================
# JSON Definition Builder
# =============================================================================

def _resolve_json_ref(ref_spec) -> dict | None:
    """Resolve a JSON definition reference to a Python ref dict.

    Supports:
        {"var": "VariableName"} → ref_variable()
        {"output": "action_label"} → deferred (handle lookup)
        {"input": true} → ref_extension_input()
        {"attachment_var": "VariableName"} → ref_variable() wrapped for attachment
    """
    if not isinstance(ref_spec, dict):
        return None
    if "var" in ref_spec:
        return ref_variable(ref_spec["var"])
    if "input" in ref_spec and ref_spec["input"]:
        return ref_extension_input()
    return None


def build_from_definition(definition: dict, output_path: str) -> Path:
    """Build a .shortcut file from a JSON definition.

    Definition schema:
    {
        "icon": {"color": "blue", "glyph": "globe"},
        "input_types": ["app", "av_asset"],
        "output_types": [],
        "types": ["ActionExtension", "WFWorkflowTypeShowInSearch"],
        "import_questions": [...],
        "actions": [
            {"type": "text", "text": "hello", "label": "greeting"},
            {"type": "set_variable", "name": "msg", "input": {"output": "greeting"}},
            {"type": "if", "condition": "has_any_value", "input": {"var": "msg"}},
            {"type": "menu", "prompt": "Pick one", "items": ["A", "B"]},
            {"type": "menu_case", "title": "A"},
            {"type": "end_menu"},
            {"type": "end_if"},
            {"type": "get_url", "url": "https://...", "method": "POST",
             "headers": [{"key": "Auth", "value": "token", "type": "text"}],
             "form_values": [
                 {"key": "file", "value": {"var": "AudioFile"}, "type": "file"},
                 {"key": "name", "value": [{"var": "MyName"}], "type": "text"}
             ]}
        ]
    }
    """
    icon = definition.get("icon", {})
    builder = ShortcutBuilder(
        icon_color=icon.get("color", "blue"),
        icon_glyph=icon.get("glyph", "shortcut"),
    )

    # Input/output types
    for it in definition.get("input_types", []):
        builder.input_classes.append(CONTENT_CLASSES.get(it, it))
    builder.has_input_variables = len(builder.input_classes) > 0

    for ot in definition.get("output_types", []):
        builder.output_classes.append(CONTENT_CLASSES.get(ot, ot))

    # Workflow types
    if "types" in definition:
        builder.types = definition["types"]
    if definition.get("share_sheet"):
        builder.add_share_sheet()

    # Import questions
    for q in definition.get("import_questions", []):
        builder.add_import_question(
            prompt=q["prompt"], variable=q["variable"],
            qtype=q.get("type", "Text"), default=q.get("default", ""),
        )

    # Track labeled actions for output references
    label_handles: dict[str, ActionHandle] = {}

    for action_def in definition.get("actions", []):
        action_def = dict(action_def)
        atype = action_def.pop("type", "raw")
        label = action_def.pop("label", None)

        # Resolve input references
        if "input" in action_def:
            inp = action_def["input"]
            if isinstance(inp, dict):
                if "output" in inp:
                    # Lookup by label
                    ref_label = inp["output"]
                    if ref_label in label_handles:
                        action_def["input"] = ref_output(label_handles[ref_label])
                    else:
                        raise ValueError(f"Unknown output label: {ref_label!r}")
                else:
                    resolved = _resolve_json_ref(inp)
                    if resolved:
                        action_def["input"] = resolved

        # Resolve dict field references (headers, form_values, json_values)
        for field in ("headers", "form_values", "json_values"):
            if field in action_def and isinstance(action_def[field], list):
                for item in action_def[field]:
                    if isinstance(item.get("value"), dict):
                        v = item["value"]
                        if "var" in v:
                            item["value"] = ref_variable(v["var"])
                        elif "output" in v:
                            if v["output"] in label_handles:
                                item["value"] = ref_output(label_handles[v["output"]])
                        elif "input" in v and v["input"]:
                            item["value"] = ref_extension_input()
                    elif isinstance(item.get("value"), list):
                        # Interpolated text segments
                        resolved = []
                        for seg in item["value"]:
                            if isinstance(seg, str):
                                resolved.append(seg)
                            elif isinstance(seg, dict):
                                if "var" in seg:
                                    resolved.append(ref_variable(seg["var"]))
                                elif "output" in seg:
                                    if seg["output"] in label_handles:
                                        resolved.append(ref_output(label_handles[seg["output"]]))
                                elif "input" in seg and seg["input"]:
                                    resolved.append(ref_extension_input())
                        item["value"] = resolved

        if atype == "raw":
            handle = builder.add_raw_action(
                action_def.get("identifier", ""),
                action_def.get("parameters", {}),
            )
        else:
            handle = builder.add_action(atype, **action_def)

        if label:
            label_handles[label] = handle

    # Validate
    warnings = builder.validate()
    for w in warnings:
        print(f"⚠️  {w}", file=sys.stderr)

    return builder.save(output_path)


# =============================================================================
# CLI entrypoint
# =============================================================================
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: generate_shortcut.py <definition.json> [output.shortcut]")
        print("       Reads a JSON definition and outputs a .shortcut file.")
        sys.exit(1)

    def_path = sys.argv[1]
    with open(def_path, "r") as f:
        definition = json.load(f)

    name = definition.get("name", "shortcut")
    out_path = sys.argv[2] if len(sys.argv) > 2 else f"{name.lower().replace(' ', '-')}.shortcut"

    result = build_from_definition(definition, out_path)
    print(f"✅ Shortcut saved: {result} ({result.stat().st_size} bytes)")
