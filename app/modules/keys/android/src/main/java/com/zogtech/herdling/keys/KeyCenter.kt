package com.zogtech.herdling.keys

import android.view.KeyEvent

/** One shortcut: a key code and the modifiers it needs. `command` matches Meta or Ctrl. */
data class KeyCommand(
  val id: String,
  val keyCode: Int,
  val command: Boolean,
  val control: Boolean,
  val shift: Boolean,
  val alternate: Boolean,
) {
  /** True when a key press with these modifier states is this shortcut. */
  fun matches(code: Int, meta: Boolean, ctrl: Boolean, shiftOn: Boolean, altOn: Boolean): Boolean {
    if (code != keyCode && !(keyCode == KeyEvent.KEYCODE_ENTER && code == KeyEvent.KEYCODE_NUMPAD_ENTER)) return false
    if (command && !(meta || ctrl)) return false
    if (!command && !control && (meta || ctrl)) return false
    if (control && !ctrl) return false
    return shift == shiftOn && alternate == altOn
  }

  companion object {
    /** A shortcut from the JS shape `{id, input, modifiers}`, or null when the key is unknown. */
    fun from(map: Map<String, Any?>): KeyCommand? {
      val id = map["id"] as? String ?: return null
      val input = map["input"] as? String ?: return null
      val code = keyCode(input) ?: return null
      val mods = (map["modifiers"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
      return KeyCommand(id, code, "command" in mods, "control" in mods, "shift" in mods, "alternate" in mods)
    }

    /** The Android key code of a JS key input: one letter, digit or bracket, "enter" or "escape". */
    fun keyCode(input: String): Int? {
      when (input) {
        "enter" -> return KeyEvent.KEYCODE_ENTER
        "escape" -> return KeyEvent.KEYCODE_ESCAPE
        "[" -> return KeyEvent.KEYCODE_LEFT_BRACKET
        "]" -> return KeyEvent.KEYCODE_RIGHT_BRACKET
        "." -> return KeyEvent.KEYCODE_PERIOD
      }
      if (input.length != 1) return null
      val c = input[0].lowercaseChar()
      return when (c) {
        in '0'..'9' -> KeyEvent.KEYCODE_0 + (c - '0')
        in 'a'..'z' -> KeyEvent.KEYCODE_A + (c - 'a')
        else -> null
      }
    }
  }
}

/** The active shortcuts and the event sink. The module writes them; the activity handler reads them. */
object KeyCenter {
  @Volatile var commands: List<KeyCommand> = emptyList()
  @Volatile var onPress: ((String) -> Unit)? = null

  /** Sends the matching shortcut and returns true, or returns false when no shortcut matches. */
  fun handle(keyCode: Int, event: KeyEvent?): Boolean {
    if (event == null) return false
    val hit = commands.firstOrNull {
      it.matches(keyCode, event.isMetaPressed, event.isCtrlPressed, event.isShiftPressed, event.isAltPressed)
    } ?: return false
    // A held key repeats: the shortcut runs once, the repeats are only consumed.
    if (event.repeatCount == 0) onPress?.invoke(hit.id)
    return true
  }
}
