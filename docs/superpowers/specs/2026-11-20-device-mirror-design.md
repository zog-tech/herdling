# Device mirror: iOS simulators and Android emulators on the phone

Status: approved by the maintainer, implemented in herdlingd 0.2.1 and the next app update.

## Intent

An agent often builds a mobile app and runs it in an iOS simulator or an Android emulator on
the computer. The user wants to see that screen on the phone and use it: tap, swipe, type text,
and press Home, Back and a few hardware buttons. The screen must move as smooth video, not as
a slide show, when the computer can make video.

The feature must not need a new native module in the app. The app part ships as an OTA update.

## Approaches considered

1. **Screenshot stream.** herdlingd takes a screenshot (`xcrun simctl io <udid> screenshot`,
   `adb exec-out screencap -p`) again and again and sends the images. Simple and always
   available, but slow: one `simctl` screenshot takes about 0.5 to 0.8 s and a full-size JPEG of
   an iPhone is about 0.5 MB. It gives 1 to 2 frames per second. We keep it only as the fallback.
2. **Video stream through the browser preview tunnel.** herdlingd reads H.264 from the device
   (scrcpy server on Android, `idb video-stream` on iOS) and sends it over a WebSocket to a small
   player page. The page decodes with WebCodecs and draws on a canvas. The page loads in the
   preview web view, through the preview tunnel that already exists. This needs no new native
   code: `react-native-webview` and the ssh module's preview listener are in the current builds.
3. **A native scrcpy client in the app.** The best latency, but it needs a native decoder and a
   new native build, and it covers only Android.

We use approach 2 with approach 1 as its fallback.

## Overview

```
Phone: preview web view ──http/ws──▶ ssh module listener ──SSH exec "herdlingd proxy <port> <grant>"──▶
Computer: herdlingd rpc (mirror server on 127.0.0.1:<port>) ──▶ scrcpy server (adb) / idb / simctl
```

- `devices.list` lists the booted iOS simulators and the Android emulators.
- `mirror.start {device}` starts a mirror server for the device in the `herdlingd rpc` process of
  the call. The server listens on `127.0.0.1` on a random port. It serves the player page and the
  WebSocket under a secret path `/m/<token>/`. The call also issues a preview grant for the port
  (the same grant file as `preview.open`) and returns the port, the path and the grant.
- The app starts the preview tunnel for that port with the grant, and loads
  `http://localhost:<local port>/m/<token>/` in the web view.
- `mirror.stop {device}` stops the mirror server and its source processes.

### Why the rpc process owns the server

The rpc process lives while the app has its SSH connection. When the app goes away, the rpc
process ends and the mirror ends with it, so no source process stays behind. `serve` would need
a new channel between `rpc` and `serve`. Each rpc process has its own mirrors: two phones get two
mirror servers. scrcpy supports this (each server has its own `scid`).

## Sources

### Android

1. Find `adb`: `PATH`, `$ANDROID_HOME/platform-tools`, `$ANDROID_SDK_ROOT/platform-tools`,
   `~/Library/Android/sdk/platform-tools` (macOS), `~/Android/Sdk/platform-tools` (Linux).
2. Video and control: the scrcpy server (Apache-2.0), version and SHA-256 pinned in
   `companion/scrcpy-pin.json`. herdlingd downloads it once from the official GitHub release
   into `~/.local/share/herdling/scrcpy-server-v<version>`, checks the SHA-256 (also before each
   use) and pushes it with `adb -s <serial> push` to `/data/local/tmp/herdling-scrcpy.jar`.
3. `adb -s <serial> forward tcp:0 localabstract:scrcpy_<scid>` and then
   `adb -s <serial> shell CLASSPATH=... app_process / com.genymobile.scrcpy.Server <version>
   scid=<scid> tunnel_forward=true audio=false control=true video_codec=h264 max_size=<n>
   send_device_meta=false cleanup=true`.
4. herdlingd opens two TCP connections to the forwarded port: video first, then control. The
   first one gets a dummy byte when the server is ready. The video socket carries the codec id,
   then session packets (the video size, sent again after a rotation) and media packets with a
   12-byte header (config flag, key frame flag, PTS, size).
5. Input goes over the scrcpy control socket: touch events (down, move, up), key codes (Home 3,
   Back 4, App switch 187, Power 26, Volume up 24, Volume down 25), text (at most 300 bytes per
   message), "rotate device" and "reset video" (asks for a new key frame). The touch position
   is in video pixels with the video size: scrcpy maps it to the display and handles the rotation.

Fallback when the scrcpy server is not available (no download, a bad checksum, the server does
not start): screenshots with `adb -s <serial> exec-out screencap -p` (PNG) and input with
`adb shell input tap|swipe|text|keyevent`. The position is in screenshot pixels, which are the
device pixels in the current rotation.

### iOS simulator

1. Video: `sim-video stream --set <device set> --udid <udid> --transport annex-b -` writes raw
   H.264 (Annex B) to stdout. `sim-video` comes with idb 1.7.8 and later (the release archive
   `idb-companion.macos-arm64.tar.gz`; the Homebrew formula keeps it in `libexec` beside
   `idb_companion`). It reads the simulator framebuffer through CoreSimulator and encodes with
   VideoToolbox, so it needs no gRPC companion and no screen recording permission. It stops when
   its stdin ends, so herdlingd keeps the stdin pipe open. Without `sim-video`, herdlingd uses
   `idb video-stream --udid <udid> --format h264`. herdlingd splits the stream into access units
   and finds the key frames (IDR, with SPS and PPS).
2. Input: `idb ui tap|swipe|text|button --udid <udid>` (buttons `HOME`, `LOCK`, `SIDE_BUTTON`,
   `SIRI`). idb takes points. herdlingd reads the screen scale (`density`) from
   `idb describe --udid <udid> --json` once and divides the frame pixels by it.
3. idb needs `idb` (the Python client, `pipx install fb-idb` or `uv tool install fb-idb`) and
   `idb_companion` (`brew install facebook/fb/idb-companion`). The idb client starts a companion
   for the simulator itself. The companion is a shared daemon, like the adb server: herdlingd
   does not stop it. herdlingd stops only its own `idb video-stream` process.
4. Some `idb_companion` builds stop with a fatal error on `video-stream` (seen with the build of
   2026-08-19 on iOS 26.5). The cause is in the companion: its video handler reads the first
   request with one iterator of the gRPC request stream and then loops over the stream with a
   second iterator, and the grpc-swift 1 stream allows only one ("NIOThrowingAsyncSequenceProducer
   allows only a single AsyncIterator"). idb 1.7.x (grpc-swift 2) does not have this fault. The client then reports "Connection lost", and the next idb calls
   fail with "Failed to connect to companion" until `idb disconnect <udid>` clears the stale
   entry. herdlingd handles this: when the video source fails before the first frame, it runs
   `idb disconnect <udid>` once, uses screenshots for this mirror, and keeps the idb input.

Fallback without idb: screenshots with `xcrun simctl io <udid> screenshot --type=jpeg <file>`
(into a private temporary folder; `simctl` cannot write to stdout) and view only.

### Screenshots

The screenshot source takes a screenshot, sends it, and waits until at least 250 ms passed since
the start of the last one. The same image twice in a row is not sent again.

## The player page

The page is one HTML file with inline CSS and JavaScript, embedded in the herdlingd binary
(`companion/src/mirror/page.html`). It makes no request to another host.

- It checks `VideoDecoder` (WebCodecs) and `VideoDecoder.isConfigSupported` for the stream codec.
  iOS WKWebView has WebCodecs from iOS 16.4, and Android WebView from Chromium 94. The app needs
  iOS 17 or later, so every supported phone has it. `http://localhost` is a secure context, so
  WebCodecs is available on the preview origin.
- It connects to `ws://<host>/m/<token>/ws?video=1` (or `video=0` without WebCodecs). With
  `video=0`, the server uses screenshots for this mirror.
- Video: each binary message is one access unit. The page configures a `VideoDecoder` with the
  codec string from the SPS (`avc1.PPCCLL`) and no `description`, so the decoder reads Annex B.
  It decodes each unit at once and draws the newest frame on a canvas in the next animation
  frame. Old frames are closed and dropped: there is no buffer. After a decode error it waits
  for the next key frame.
- Screenshots: each binary message is one JPEG or PNG. The page draws it with `createImageBitmap`.
- Touch: pointer events on the canvas give positions from 0 to 1 in the frame. The page sends
  `down`, `move` (at most one per animation frame) and `up`. herdlingd knows the frame size itself
  (scrcpy session packets, the PNG header, `idb describe`), so the page does not send it.
- When the decoder falls behind or fails, the page sends `{"t":"keyframe"}` and waits for a key frame.
- The app sends commands to the page with `postMessage` (`{"t":"key","key":"home"}`,
  `{"t":"text","text":"..."}`, `{"t":"rotate"}`). The page sends them on the WebSocket. The page
  posts its state to the app (`ReactNativeWebView.postMessage`): connected, source, input, error.

### Why there is no Media Source Extensions fallback

The first design had a fallback to Media Source Extensions with an inline fMP4 muxer when
WebCodecs is missing. We left it out: on iPhone, `ManagedMediaSource` comes with iOS 17.1 and
WebCodecs already came with iOS 16.4, and Android WebView has had WebCodecs since 2021. So the
MSE path would never run on a supported phone. The screenshot fallback covers a decoder that
cannot take the stream (`isConfigSupported` false or a decoder error).

## WebSocket messages

Server to page, binary: byte 0 is the kind, byte 1 the flags, then the payload.

| Kind | Payload |
|---|---|
| 1 | One H.264 access unit, Annex B. Flag bit 0: key frame (SPS and PPS come first). |
| 2 | One JPEG image. |
| 3 | One PNG image. |

Server to page, text: JSON objects.

- `{"type":"state","state":"starting"|"streaming"|"waiting","source":"video"|"screenshots","input":true,"platform":"ios"|"android","name":"..."}`
- `{"type":"error","message":"..."}`: the source failed. The page shows the message and a Retry button.

Page to server, text: JSON objects.

- `{"t":"touch","phase":"down"|"move"|"up"|"cancel","x":0.5,"y":0.25}`
- `{"t":"key","key":"home"|"back"|"app_switch"|"power"|"volume_up"|"volume_down"|"lock"|"siri"}`
- `{"t":"text","text":"..."}` (at most 1000 characters)
- `{"t":"rotate"}` (Android only)
- `{"t":"keyframe"}`: the page decoder needs a key frame (scrcpy "reset video")

An unknown message is ignored. Each input message is checked and changed to a device action by
pure code (`mirror/input.rs`).

## Input mapping

Positions from the page are fractions of the frame (0 to 1), so they do not depend on the size
of the canvas on the phone.

- scrcpy: `x = round(fx * w)`, clamped to `0..w-1`, with `w`, `h` from the last session packet.
  The message carries `w`, `h`, so scrcpy maps to the display.
- adb input: the same with the size of the last screenshot (device pixels).
- idb: frame pixels divided by the scale, in points.

scrcpy gets every touch event. adb and idb have no touch down and up, so a pure gesture
recognizer turns a down, moves and an up into one action: a tap (less than 2 % of the frame
and less than 500 ms), a long press (a swipe from a point to the same point with the press
time) or a swipe (from the down to the up point, 50 ms to 2 s).

## Lifecycle

One mirror per device in each rpc process. A second `mirror.start` for the same device returns
the same server and a new grant. More viewers of one mirror share it.

The session is a pure state machine (`mirror/machine.rs`):

```
Waiting ──viewer joins──▶ Starting(gen) ──source ready──▶ Streaming(gen)
Streaming ──last viewer leaves──▶ Grace(gen, until) ──viewer joins──▶ Streaming(gen)
Grace ──time passes──▶ Waiting (stop source)
Starting/Streaming ──source ends──▶ Waiting (error to the viewers)
Waiting ──no viewer for 5 min──▶ Stopped (server closes)
any ──mirror.stop or rpc exit──▶ Stopped (stop source, close server)
```

- Each source attempt has a generation number. A result of an old generation is ignored.
- The grace time is 10 s, so a reload of the page or a short background of the app does not
  restart the source.
- A new viewer gets the cached frames from the last key frame on (at most 300 units or 16 MiB),
  then the live frames. A viewer that falls behind skips to the next key frame; for scrcpy,
  herdlingd asks for a new key frame.
- Source processes run with `kill_on_drop`. When the rpc loop ends, herdlingd stops each mirror,
  kills the processes and removes the adb forward. When the TCP connections to the scrcpy server
  close, the server ends on the device (`cleanup=true` restores the device settings).
- When the rpc process dies at once (SIGKILL), the kernel closes its sockets and pipes: the
  scrcpy server and `idb video-stream` then end on their own.

## Security

- The mirror server listens on `127.0.0.1` only. Another local user can connect to the port, but
  each request must have the path `/m/<token>/` with a 128-bit random token (compared in constant
  time). Any other path gets 404. The token is not on a command line and not in a file.
- The `Host` header must be `localhost`, `127.0.0.1` or `[::1]` with a port: this blocks DNS
  rebinding. The WebSocket upgrade must have an `Origin` equal to `http://<Host>`: a page on
  another origin in a browser of the computer cannot open it.
- The phone side keeps the preview rules: the listener on the phone is on `127.0.0.1`, needs the
  preview cookie, and the proxy needs a live grant for this port and a listener of this user.
- The page has a strict Content Security Policy (`default-src 'none'`, inline script and style
  only, `connect-src` the page host and `ws://localhost:*` or `ws://127.0.0.1:*`, `img-src blob:`),
  and `Referrer-Policy: no-referrer`.
- The scrcpy server comes only from the pinned GitHub release URL and must match the pinned
  SHA-256. A file in the data folder with another checksum is downloaded again.
- Real Android devices are listed with `kind: "device"` and are not offered by the app.
  `mirror.start` refuses them unless `allow_device: true` is set.
- `devices.list` runs only read commands. It asks a serial for its name and Android version only
  when it is an emulator (`emulator-<port>`).
- Text input goes to the device as an argument list, never through a shell on the computer. For
  `adb shell input text`, herdlingd escapes the text for the device shell.

## RPC

See `docs/protocol.md`, "Device mirror".

## App

- The host screen has a "Simulators" row when the host lists `devices.list`. The session "..."
  menu has "Simulators" too. Both open the device list (`/devices/[hostId]`).
- The device list shows the booted simulators and the emulators, with the tools that are
  missing. A tap opens the mirror screen (`/mirror/[hostId]/[device]`).
- The mirror screen runs a tunnel state machine (`mirror/tunnel.ts`, run by `MirrorRunner` in
  `mirror/useMirror.ts`): `mirror.start`, then `ssh.startPreview` with the grant, then the web view.
  Background and a lost connection release the phone side (the computer keeps the source for the
  grace time); close also calls `mirror.stop` and `preview.close`.
- A toolbar: Close, Back, Home and Recent apps (Android), Home and Lock (iOS), Rotate (Android),
  and a Keyboard button that shows a text field. Send types the text on the device.
- The demo host does not list `devices.list`, so it does not show the feature.

## What was verified on a Mac

- Android (API 35 emulator, scrcpy 5.0.1): H.264 video decoded with WebCodecs in Chromium, a tap
  opened an app, Home and Back worked, typed text reached a search field. 10 s after the page
  closed, no `app_process` ran on the emulator, the adb forward was gone, and no `adb shell` ran.
- iOS (iOS 26.5 simulator, idb_companion build of 2026-08-19): `idb video-stream` made the
  companion stop with a fatal error, the mirror moved to screenshots in about 2 s, `idb disconnect`
  cleared the stale companion, and taps and the Home button worked through idb.
- iOS (iOS 26.5 simulator, `sim-video` of idb 1.7.8): through `mirror.start` and the WebSocket,
  the source stayed on video at 588x1280 (`max_size` 1280), up to 58 fps during an animation and
  no frames while idle, first frame in about 0.5 s, and a screen change reached the WebSocket
  about 100 ms after `simctl` applied it. `ffprobe` decoded every frame (H.264 High, no B-frames).
  `sim-video` also ran from a launchd job. A missing `sim-video` moved the mirror to screenshots.
- Not verified on a phone: the WebSocket through the phone's preview listener (the listener copies
  raw bytes after the cookie check, as for a dev server with hot reload).

## Left for later

- Audio (scrcpy can send it; the page would need a decoder and a buffer).
- Multi-touch (pinch).
- Real devices (USB or Wi-Fi), behind a setting.
- The clipboard in both directions.
- iOS rotation: idb takes points of the screen in portrait; landscape taps are not mapped yet.
- H.265 or AV1 for a smaller stream.
