Pod::Spec.new do |s|
  s.name           = 'SshModule'
  s.version        = '1.0.0'
  s.summary        = 'SSH client for Zogssh (Citadel / SwiftNIO SSH)'
  s.description    = 'Ed25519 key in Keychain, host key pinning and streaming exec channels.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # Citadel through Swift Package Manager (React Native's spm_dependency helper).
  # Pinned to an exact version. Citadel 0.12.1 is the first release with `withExec`.
  spm_dependency(s,
    url: 'https://github.com/orlandos-nl/Citadel.git',
    requirement: { kind: 'exactVersion', version: '0.12.1' },
    products: ['Citadel']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
