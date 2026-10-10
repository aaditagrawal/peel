import ExpoModulesCore
import UIKit

public class WhatsAppStickersModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhatsAppStickers")
    AsyncFunction("addPack") { (payload: String, promise: Promise) in
      guard let data = payload.data(using: .utf8),
            let pack = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let stickers = pack["stickers"] as? [[String: Any]], (3...30).contains(stickers.count) else {
        promise.reject("INVALID_PACK", "A pack needs 3 to 30 stickers.")
        return
      }
      DispatchQueue.main.async {
        guard let url = URL(string: "whatsapp://stickerPack"), UIApplication.shared.canOpenURL(url) else {
          promise.reject("NOT_INSTALLED", "Install WhatsApp to add this sticker pack.")
          return
        }
        UIPasteboard.general.setItems([["net.whatsapp.third-party.sticker-pack": data]], options: [.localOnly: true, .expirationDate: Date(timeIntervalSinceNow: 60)])
        UIApplication.shared.open(url, options: [:]) { opened in
          if opened { promise.resolve(true) }
          else { promise.reject("OPEN_FAILED", "WhatsApp could not be opened.") }
        }
      }
    }
  }
}
