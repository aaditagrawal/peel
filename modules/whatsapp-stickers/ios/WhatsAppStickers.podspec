Pod::Spec.new do |s|
  s.name = 'WhatsAppStickers'
  s.version = '1.0.0'
  s.summary = 'Peel WhatsApp sticker pack handoff'
  s.description = 'Native WhatsApp sticker pack handoff for Peel.'
  s.author = 'Peel'
  s.homepage = 'https://github.com/WhatsApp/stickers'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
