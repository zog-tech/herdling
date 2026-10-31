Pod::Spec.new do |s|
  s.name           = 'SshModule'
  s.version        = '1.0.0'
  s.summary        = 'SSH client for Herdling (Citadel / SwiftNIO SSH) and Parakeet transcription (FluidAudio)'
  s.description    = 'Ed25519 key in Keychain, host key pinning and streaming exec channels.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network'

  # Citadel through Swift Package Manager (React Native's spm_dependency helper).
  # Pinned to an exact version. Citadel 0.12.1 is the first release with `withExec`.
  spm_dependency(s,
    url: 'https://github.com/orlandos-nl/Citadel.git',
    requirement: { kind: 'exactVersion', version: '0.12.1' },
    products: ['Citadel']
  )

  # FluidAudio (Parakeet on Core ML) for voice input: ParakeetModule.swift and Parakeet.swift.
  # They live in this pod because React Native builds a static pod with a Swift package into the
  # shared products folder, and a second such pod there breaks clang (two module maps with an
  # umbrella header in one folder).
  # Pinned to an exact version: the ASR API changes between minor releases. Needs iOS 17.
  # 0.12.x does not compile with the Swift 6.3 compiler (strict concurrency errors).
  spm_dependency(s,
    url: 'https://github.com/FluidInference/FluidAudio.git',
    requirement: { kind: 'exactVersion', version: '0.17.7' },
    products: ['FluidAudio']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
