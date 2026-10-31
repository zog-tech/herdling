Pod::Spec.new do |s|
  s.name           = 'HerdlingKeys'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard shortcuts'
  s.description    = 'Registers UIKeyCommands on the root view controller and sends each press to JS. iPadOS shows them in the shortcut list.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
