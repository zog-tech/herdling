package com.zogtech.herdling.ssh

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import net.schmizz.sshj.common.Ed25519KeyFactory
import net.schmizz.sshj.userauth.keyprovider.KeyPairWrapper
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Security
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The phone's ed25519 key pair: the 32-byte seed and the 32-byte public key. */
class KeyMaterial(val seed: ByteArray, val publicKey: ByteArray) {
  /** The key pair for sshj public key login. */
  fun keyProvider(): KeyPairWrapper {
    Crypto.ensure()
    return KeyPairWrapper(Ed25519KeyFactory.getPublicKey(publicKey), Ed25519KeyFactory.getPrivateKey(seed))
  }
}

/** Puts the full BouncyCastle provider in place of the reduced one that Android has under "BC". */
object Crypto {
  @Volatile private var done = false

  @Synchronized
  fun ensure() {
    if (done) return
    // Android's "BC" provider has no ed25519 or X25519, and sshj looks up "BC" by name.
    Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
    Security.addProvider(BouncyCastleProvider())
    done = true
  }
}

/**
 * Stores the phone's ed25519 key. The Android Keystore cannot hold ed25519 keys on all Android
 * versions, so the seed is encrypted with an AES-GCM key from the Keystore. The encrypted seed
 * is in the app's private preferences. The Keystore key never leaves the device.
 */
object Keys {
  private const val PREFS = "herdling.ssh"
  private const val PREF_SEED = "ed25519.seed.v1"
  private const val WRAP_ALIAS = "herdling.ssh-key.wrap"
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  private const val GCM_TAG_BITS = 128
  private val lock = Any()

  /** Returns the stored key. Makes and stores one on first use. */
  fun loadOrCreate(context: Context): KeyMaterial = synchronized(lock) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val stored = prefs.getString(PREF_SEED, null)
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    // Without the wrapping key (for example after a restore to a new device) the stored seed
    // cannot be read: make a new key, like a new phone.
    if (stored != null && keyStore.containsAlias(WRAP_ALIAS)) {
      return fromSeed(unwrap(stored, wrapKey(keyStore)))
    }
    val seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val wrapped = wrap(seed, wrapKey(keyStore))
    if (!prefs.edit().putString(PREF_SEED, wrapped).commit()) {
      throw IllegalStateException("Cannot store the SSH key")
    }
    fromSeed(seed)
  }

  /** The OpenSSH public key line with this device's name in the comment. */
  fun openSshPublicKey(context: Context, key: KeyMaterial): String =
    KeyFormat.openSshPublicKey(key.publicKey, deviceName(context))

  private fun fromSeed(seed: ByteArray): KeyMaterial {
    val publicKey = Ed25519PrivateKeyParameters(seed, 0).generatePublicKey().encoded
    return KeyMaterial(seed, publicKey)
  }

  /** The name the user gave the device, else the model name. */
  private fun deviceName(context: Context): String {
    val name = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
      Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
    } else {
      null
    }
    return name?.takeIf { it.isNotBlank() } ?: Build.MODEL ?: ""
  }

  private fun wrapKey(keyStore: KeyStore): SecretKey {
    (keyStore.getEntry(WRAP_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  /** `base64(iv) + "." + base64(ciphertext)`. The Keystore picks the IV. */
  private fun wrap(seed: ByteArray, key: SecretKey): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val sealed = cipher.doFinal(seed)
    return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(sealed, Base64.NO_WRAP)
  }

  private fun unwrap(text: String, key: SecretKey): ByteArray {
    val parts = text.split(".")
    require(parts.size == 2) { "The stored SSH key has a bad format" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, Base64.decode(parts[0], Base64.NO_WRAP)))
    return cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP))
  }
}
