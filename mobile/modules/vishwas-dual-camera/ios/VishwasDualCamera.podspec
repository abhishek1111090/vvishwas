Pod::Spec.new do |s|
  s.name           = 'VishwasDualCamera'
  s.version        = '1.0.0'
  s.summary        = 'Simultaneous front + back video recording for VISHWAS (AVCaptureMultiCamSession).'
  s.description    = s.summary
  s.author         = 'VISHWAS'
  s.homepage       = 'https://example.invalid/vishwas'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
