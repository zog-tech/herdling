package com.zogtech.herdling.keys

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

/**
 * Gives the React activity a key handler. The activity calls it for each key press that no view
 * (for example a text input) consumed first.
 */
class HerdlingKeysPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context): List<ReactActivityHandler> =
    listOf(
      object : ReactActivityHandler {
        override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean = KeyCenter.handle(keyCode, event)
      },
    )
}
