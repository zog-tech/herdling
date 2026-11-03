package com.zogtech.herdling.crash

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS side of the native crash capture: `read` gives the saved crash text, `clear` deletes it.
 * [HerdlingCrashPackage] installs the handler when the application starts; `OnCreate` installs it
 * too, for the case that the application listener did not run.
 */
class HerdlingCrashModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HerdlingCrash")

    OnCreate {
      val context = appContext.reactContext
      if (context != null) CrashCatcher.install(context.applicationContext)
    }

    AsyncFunction("read") {
      val context = appContext.reactContext
      if (context == null) null else CrashCatcher.read(context)
    }

    AsyncFunction("clear") {
      val context = appContext.reactContext
      if (context != null) CrashCatcher.clear(context)
    }
  }
}
