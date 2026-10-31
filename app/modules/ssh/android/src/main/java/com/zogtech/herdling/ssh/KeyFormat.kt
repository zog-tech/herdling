package com.zogtech.herdling.ssh

import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64

/** OpenSSH text formats of ed25519 keys. Pure functions, the same output as the iOS module. */
object KeyFormat {
  /** SSH wire blob of an ed25519 public key: string "ssh-ed25519", then string <32 key bytes>. */
  fun ed25519WireBlob(publicKey: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    appendSshString(out, "ssh-ed25519".toByteArray(Charsets.US_ASCII))
    appendSshString(out, publicKey)
    return out.toByteArray()
  }

  /** OpenSSH public key line: `ssh-ed25519 <base64 wire blob> herdling:<device name>`. */
  fun openSshPublicKey(publicKey: ByteArray, deviceName: String): String {
    val blob = Base64.getEncoder().encodeToString(ed25519WireBlob(publicKey))
    return "ssh-ed25519 $blob ${comment(deviceName)}"
  }

  /**
   * Key comment `herdling:<name>`, so the host's authorized_keys shows which phone a line is for.
   * The name keeps only `[A-Za-z0-9._-]`; other runs become one `-`.
   */
  fun comment(deviceName: String): String {
    val out = StringBuilder()
    var i = 0
    while (i < deviceName.length) {
      val cp = deviceName.codePointAt(i)
      i += Character.charCount(cp)
      val ok = cp in 'a'.code..'z'.code || cp in 'A'.code..'Z'.code || cp in '0'.code..'9'.code ||
        cp == '.'.code || cp == '_'.code || cp == '-'.code
      if (ok) {
        out.append(cp.toChar())
      } else if (!out.endsWith("-")) {
        out.append('-')
      }
    }
    val name = out.toString().trim('-')
    return if (name.isEmpty()) "herdling" else "herdling:$name"
  }

  /** OpenSSH-style fingerprint of a public key wire blob: `SHA256:<base64 without padding>`. */
  fun fingerprint(wireBlob: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(wireBlob)
    return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
  }

  private fun appendSshString(out: ByteArrayOutputStream, bytes: ByteArray) {
    val n = bytes.size
    out.write(n ushr 24 and 0xFF)
    out.write(n ushr 16 and 0xFF)
    out.write(n ushr 8 and 0xFF)
    out.write(n and 0xFF)
    out.write(bytes)
  }
}
