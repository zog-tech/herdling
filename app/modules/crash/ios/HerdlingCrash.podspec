Pod::Spec.new do |s|
  s.name           = 'HerdlingCrash'
  s.version        = '1.0.0'
  s.summary        = 'Native crash capture'
  s.description    = 'Writes an uncaught NSException to a small file. The next launch adds it to the crash log.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
