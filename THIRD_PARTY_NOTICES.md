# Third-party notices

Herdling is under the [Mozilla Public License 2.0](LICENSE).
It uses the open-source software below. Each project keeps its own license and copyright.

This file is a summary of the main dependencies. It is not a full list of every transitive package.
The full license texts are in each package: in `node_modules/` after `pnpm install`, in the Cargo
registry after `cargo build`, and in the Swift Package and Gradle caches after a native build.
The versions are the ones in the lock files and build files of this repository.

## The app (`app/`)

### JavaScript

| Package | Version | License |
|---|---|---|
| Expo (`expo` and the `expo-*` modules, Expo Router) | SDK 58 | MIT |
| React, React DOM | 19.3.0 | MIT |
| React Native | 0.88.1 | MIT |
| React Native Web | 0.21.4 | MIT |
| React Native Reanimated | 4.7.1 | MIT |
| React Native Worklets | 0.13.0 | MIT |
| React Native Gesture Handler | 3.3.0 | MIT |
| React Native Screens | 4.30 | MIT |
| React Native Safe Area Context | 5.10 | MIT |
| React Native SVG | 15.16.0 | MIT |
| `@ronradtke/react-native-markdown-display` | 8.1.0 | MIT |
| Lucide (`lucide-react-native`) | 1.64 | ISC |
| Zustand | 5.0 | MIT |
| `@expo-google-fonts/jetbrains-mono` | 0.4.1 | MIT (package) |
| JetBrains Mono (the font files) | | SIL Open Font License 1.1 |

Development only (not in the app): Jest and `jest-expo` (MIT), TypeScript (Apache-2.0).

### iOS native modules (`app/modules/*/ios`)

These come through Swift Package Manager.

| Package | Version | License |
|---|---|---|
| [Citadel](https://github.com/orlandos-nl/Citadel) | 0.12.1 | MIT |
| [SwiftNIO SSH](https://github.com/apple/swift-nio-ssh) | (Citadel dependency) | Apache-2.0 |
| [SwiftNIO](https://github.com/apple/swift-nio), Swift Crypto, Swift ASN.1, Swift Atomics, Swift Collections, Swift Log, Swift System | (Citadel dependencies) | Apache-2.0 |
| [BigInt](https://github.com/attaswift/BigInt) | (Citadel dependency) | MIT |
| [FluidAudio](https://github.com/FluidInference/FluidAudio) | 0.17.7 | Apache-2.0 |

The other iOS native code uses Apple system frameworks only (Network, Speech, AVFAudio,
FoundationModels, CryptoKit, Security, UIKit).

### Android native modules (`app/modules/*/android`)

| Package | Version | License |
|---|---|---|
| [sshj](https://github.com/hierynomus/sshj) | 0.41.2 | Apache-2.0 |
| [Bouncy Castle](https://www.bouncycastle.org) (`bcprov-jdk15to18`, `bcpkix-jdk15to18`) | 1.84 | Bouncy Castle License (MIT style) |
| [SLF4J](https://www.slf4j.org) (`slf4j-nop`) | 2.0.17 | MIT |

The voice module uses Android system APIs only.

### Speech model (downloaded on request)

The app does not include a speech model. When you turn on the on-device Parakeet voice input on
iOS, the app downloads NVIDIA Parakeet TDT 0.6B (v2 or v3) in the Core ML conversion of
FluidInference from Hugging Face. The model is under the
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) license (CC-BY-4.0).

## herdlingd (`companion/`)

| Crate | Version | License |
|---|---|---|
| tokio | 1.54 | MIT |
| serde, serde_json | 1.0 | MIT OR Apache-2.0 |
| anyhow, thiserror | 1.0, 2.0 | MIT OR Apache-2.0 |
| axum | 0.8 | MIT |
| hyper | 1.12 | MIT |
| reqwest | 0.12 | MIT OR Apache-2.0 |
| rustls | 0.23 | Apache-2.0 OR ISC OR MIT |
| ring | 0.17 | Apache-2.0 AND ISC |
| webpki-roots | 1.0 | CDLA-Permissive-2.0 |
| rusqlite, libsqlite3-sys | 0.41, 0.39 | MIT |
| SQLite (bundled through libsqlite3-sys) | 3.54 | Public domain |
| sysinfo | 0.37 | MIT |
| mdns-sd | 0.13 | Apache-2.0 OR MIT |
| if-addrs | 0.13 | MIT OR BSD-3-Clause |
| qrcode | 0.14 | MIT OR Apache-2.0 |
| toml | 0.8 | MIT OR Apache-2.0 |
| dirs, fs4, libc, rand, sha2, base64 | | MIT OR Apache-2.0 |

`cargo tree` in `companion/` shows the full list of crates.

## Services

Herdling uses no Zog Tech server. Push notifications go from `herdlingd` to the Expo push service,
then through Apple Push Notification service or Firebase Cloud Messaging. Over-the-air app updates
come from Expo (EAS Update). These services have their own terms.

## Names

herdr, Claude Code, Codex, Pi and OpenCode are the names of their owners. Herdling is not made by
or affiliated with them.
