import UIKit
import WidgetKit

/// Has the iPhone's widgets of the app's (the Widget Extension, Widgets/Widgets.swift) drawn again as the app opens and
/// as it's left, so they show what was just seen in it, as WidgetKit lets an app in the foreground at any time.
@objc(OneWidgets)
final class OneWidgets: NSObject {
    @objc static func follow() {
        for name in [UIApplication.didBecomeActiveNotification, UIApplication.didEnterBackgroundNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }
}
