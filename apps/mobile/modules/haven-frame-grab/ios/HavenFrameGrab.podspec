Pod::Spec.new do |s|
  s.name           = 'HavenFrameGrab'
  s.version        = '1.0.0'
  s.summary        = 'Saves a still photo from the live camera track without stopping the stream.'
  s.description    = 'Keeps the latest frame the LiveKit camera capturer produced and writes it to a JPEG on request.'
  s.author         = 'Haven'
  s.homepage       = 'https://github.com/seasidehavenllc/haven'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'livekit-react-native-webrtc'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_ENABLE_MODULES' => 'YES'
  }

  s.source_files = '**/*.{h,m,swift}'
  s.public_header_files = 'HavenFrameKeeper.h'
end
