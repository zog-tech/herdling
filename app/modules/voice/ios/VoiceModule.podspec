Pod::Spec.new do |s|
  s.name           = 'VoiceModule'
  s.version        = '1.0.0'
  s.summary        = 'On-device dictation and recording for Herdling'
  s.description    = 'Voice recording to WAV, live speech recognition (SpeechAnalyzer on iOS 26 with installed assets, else SFSpeechRecognizer) and on-device reply summaries (FoundationModels on iOS 26).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFAudio'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
