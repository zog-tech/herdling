Pod::Spec.new do |s|
  s.name           = 'HerdlingPaste'
  s.version        = '1.0.0'
  s.summary        = 'Image paste for the prompt box'
  s.description    = 'Adds "Paste" to the edit menu of multiline text inputs when the pasteboard holds an image, and sends the image to JS as JPEG.'
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
