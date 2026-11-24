// The list of what this module offers to JavaScript: its name, one function,
// and one native view with its props and events. Expo reads this list when
// the app starts. The view itself is in SwipeRowView.swift.

import ExpoModulesCore
import UIKit

/// One action as JavaScript sends it. `symbol` and `tint` are left out when
/// there is none. The names match the JavaScript side
/// (`NativeSwipeActionProp` in packages/native/src/swipeNative/swipeNative.ts).
struct SwipeActionRecord: Record {
  @Field var key: String = ""
  @Field var label: String = ""
  /// An SF Symbol name, such as "trash".
  @Field var symbol: String? = nil
  /// "normal", "destructive" or "cancel".
  @Field var role: String = "normal"
  /// "#rrggbb" or "#rrggbbaa". Without it the role decides the colour.
  @Field var tint: String? = nil
}

public final class FoldkitSwipeModule: Module {
  public func definition() -> ModuleDefinition {
    // JavaScript finds the module by this name: expo.modules.FoldkitSwipe
    Name("FoldkitSwipe")

    // Closes every open row of a group. Views may only be touched on the
    // main thread, so the function is told to run there.
    AsyncFunction("closeAll") { (group: String) in
      MainActor.assumeIsolated {
        SwipeRowRegistry.closeAll(group: group, except: nil)
      }
    }.runOnQueue(.main)

    View(SwipeRowView.self) {
      // The three things the view tells JavaScript. Each name is also a
      // property of SwipeRowView, which is how Expo connects them.
      Events("onSwipeOpened", "onSwipeClosed", "onActionTriggered")

      Prop("actionsLeading") { (view: SwipeRowView, actions: [SwipeActionRecord]?) in
        view.setActions(actions ?? [], side: .leading)
      }

      Prop("actionsTrailing") { (view: SwipeRowView, actions: [SwipeActionRecord]?) in
        view.setActions(actions ?? [], side: .trailing)
      }

      Prop("allowsFullSwipe") { (view: SwipeRowView, allows: Bool?) in
        view.allowsFullSwipe = allows ?? true
      }

      Prop("mode") { (view: SwipeRowView, mode: String?) in
        view.setMode(SwipeRowView.Mode(rawValue: mode ?? "") ?? .tiles)
      }

      Prop("group") { (view: SwipeRowView, group: String?) in
        view.group = group ?? ""
      }

      Prop("cornerRadius") { (view: SwipeRowView, radius: Double?) in
        view.setCornerRadius(CGFloat(radius ?? 0))
      }

      Prop("isEnabled") { (view: SwipeRowView, isEnabled: Bool?) in
        view.setSwipeEnabled(isEnabled ?? true)
      }

      Prop("rowDirection") { (view: SwipeRowView, direction: String?) in
        view.setDirectionOverride(direction ?? "auto")
      }

      Prop("closeSignal") { (view: SwipeRowView, signal: Double?) in
        view.setCloseSignal(signal ?? 0)
      }

      // Called once after a batch of props has been set.
      OnViewDidUpdateProps { (view: SwipeRowView) in
        view.propsDidChange()
      }
    }
  }
}
