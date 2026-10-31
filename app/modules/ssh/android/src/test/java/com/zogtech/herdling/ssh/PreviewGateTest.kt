package com.zogtech.herdling.ssh

import org.junit.Assert.assertEquals
import org.junit.Test

class PreviewGateTest {
  private val cookie = "0123456789abcdef0123456789abcdef"

  private fun check(text: String): PreviewGate.Verdict {
    val b = text.toByteArray(Charsets.ISO_8859_1)
    return PreviewGate.check(b, b.size, cookie)
  }

  @Test
  fun acceptsTheCookie() {
    assertEquals(PreviewGate.Verdict.ALLOW, check("GET / HTTP/1.1\r\nHost: localhost:5173\r\nCookie: herdling_preview=$cookie\r\n\r\n"))
    // Other cookies, another case of the header name, a WebSocket upgrade.
    assertEquals(
      PreviewGate.Verdict.ALLOW,
      check("GET /@vite HTTP/1.1\r\nUpgrade: websocket\r\ncookie: a=1; herdling_preview=$cookie; b=2\r\n\r\n"),
    )
  }

  @Test
  fun rejectsAMissingOrWrongCookie() {
    assertEquals(PreviewGate.Verdict.DENY, check("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"))
    assertEquals(PreviewGate.Verdict.DENY, check("GET / HTTP/1.1\r\nCookie: herdling_preview=nope\r\n\r\n"))
    assertEquals(PreviewGate.Verdict.DENY, check("GET / HTTP/1.1\r\nCookie: xherdling_preview=$cookie\r\n\r\n"))
    // The cookie in the URL or in another header does not count.
    assertEquals(PreviewGate.Verdict.DENY, check("GET /?herdling_preview=$cookie HTTP/1.1\r\nX-Cookie: herdling_preview=$cookie\r\n\r\n"))
  }

  @Test
  fun waitsForTheHeadAndCapsIt() {
    assertEquals(PreviewGate.Verdict.NEED_MORE, check("GET / HTTP/1.1\r\nCookie: herdling_preview=$cookie\r\n"))
    val long = "GET / HTTP/1.1\r\nX: " + "a".repeat(PreviewGate.MAX_HEAD)
    assertEquals(PreviewGate.Verdict.DENY, check(long))
    val longComplete = long + "\r\nCookie: herdling_preview=$cookie\r\n\r\n"
    assertEquals(PreviewGate.Verdict.DENY, check(longComplete))
  }
}
