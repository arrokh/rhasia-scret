Pod::Spec.new do |s|
  s.name           = 'ExpoCryptoArgon2'
  s.version        = '1.0.0'
  s.summary        = 'Owned native Argon2id adapter for rhasia-scret'
  s.license        = { type: 'MIT AND Apache-2.0' }
  s.homepage       = 'https://github.com/arrokh/rhasia-scret'
  s.authors        = 'rhasia-scret contributors'
  s.platform       = :ios, '16.4'
  s.swift_version  = '5.4'
  s.source         = { git: '' }

  s.dependency 'ExpoModulesCore'
  s.source_files = [
    'ios/**/*.{h,m,mm,swift}',
    'c-argon2/include/argon2.h',
    'c-argon2/src/argon2.c',
    'c-argon2/src/core.c',
    'c-argon2/src/encoding.c',
    'c-argon2/src/ref.c',
    'c-argon2/src/thread.c',
    'c-argon2/src/blake2/blake2b.c',
  ]
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/c-argon2/include"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
  }
end
