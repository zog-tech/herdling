package com.zogtech.herdling.keys

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hardware keyboard shortcuts. JS sends the active shortcuts with `setCommands`. The activity
 * handler of [HerdlingKeysPackage] gets each key press and sends the id of a matching shortcut.
 */
class HerdlingKeysModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HerdlingKeys")

    Events("onKeyCommand")

    OnCreate {
      KeyCenter.onPress = { id -> sendEvent("onKeyCommand", mapOf("id" to id)) }
    }

    OnDestroy {
      KeyCenter.onPress = null
      KeyCenter.commands = emptyList()
    }

    AsyncFunction("setCommands") { commands: List<Map<String, Any?>> ->
      KeyCenter.commands = commands.mapNotNull { KeyCommand.from(it) }
    }
  }
}
