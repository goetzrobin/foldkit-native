# Tells the iOS build (CocoaPods) what this module is and which files to
# compile. Expo finds this file by itself: see docs/NATIVE_VIEWS.md.
Pod::Spec.new do |s|
  s.name           = 'FoldkitSwipe'
  s.version        = '0.1.0'
  s.summary        = 'A swipe-actions row written in UIKit, used from Foldkit.'
  s.description    = 'A row that slides sideways to show action tiles. The local native view of the Foldkit showcase app.'
  s.license        = 'MIT'
  s.author         = 'Foldkit Native'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  # Swift 5 rules. The stricter Swift 6 rules would need more annotations.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
