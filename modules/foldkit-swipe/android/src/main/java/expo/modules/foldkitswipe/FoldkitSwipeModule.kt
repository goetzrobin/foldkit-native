// The list of what this module offers to JavaScript: its name, one function,
// and one native view with its props and events. Expo reads this list when
// the app starts. The view itself is in SwipeRowView.kt.

package expo.modules.foldkitswipe

import android.view.View
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * One action as JavaScript sends it. The names match the JavaScript side
 * (`NativeSwipeActionProp` in packages/native/src/swipeNative/swipeNative.ts).
 */
class SwipeActionRecord : Record {
  @Field
  var key: String = ""

  @Field
  var label: String = ""

  /** An SF Symbol name. iOS only: Android shows the label. */
  @Field
  var symbol: String? = null

  /** "normal", "destructive" or "cancel". */
  @Field
  var role: String = "normal"

  /** "#rrggbb" or "#aarrggbb". Without it the role decides the colour. */
  @Field
  var tint: String? = null
}

class FoldkitSwipeModule : Module() {
  override fun definition() = ModuleDefinition {
    // JavaScript finds the module by this name: expo.modules.FoldkitSwipe
    Name("FoldkitSwipe")

    // Closes every open row of a group. Views may only be touched on the
    // main thread, so the function is told to run there.
    AsyncFunction("closeAll") { group: String ->
      SwipeRowRegistry.closeAll(group, null)
    }.runOnQueue(Queues.MAIN)

    View(SwipeRowView::class) {
      // The three things the view tells JavaScript. Each name is also a
      // property of SwipeRowView, which is how Expo connects them.
      Events("onSwipeOpened", "onSwipeClosed", "onActionTriggered")

      Prop("actionsLeading") { view: SwipeRowView, actions: List<SwipeActionRecord>? ->
        view.setActions(actions ?: emptyList(), SwipeRowView.Side.LEADING)
      }

      Prop("actionsTrailing") { view: SwipeRowView, actions: List<SwipeActionRecord>? ->
        view.setActions(actions ?: emptyList(), SwipeRowView.Side.TRAILING)
      }

      Prop("allowsFullSwipe") { view: SwipeRowView, allows: Boolean? ->
        view.allowsFullSwipe = allows ?: true
      }

      Prop("mode") { view: SwipeRowView, mode: String? ->
        view.setMode(SwipeRowView.Mode.from(mode))
      }

      Prop("group") { view: SwipeRowView, group: String? ->
        view.group = group ?: ""
      }

      Prop("cornerRadius") { view: SwipeRowView, radius: Float? ->
        view.setCornerRadius(radius ?: 0f)
      }

      Prop("isEnabled") { view: SwipeRowView, isEnabled: Boolean? ->
        view.setSwipeEnabled(isEnabled ?: true)
      }

      Prop("rowDirection") { view: SwipeRowView, direction: String? ->
        view.setDirectionOverride(direction ?: "auto")
      }

      Prop("closeSignal") { view: SwipeRowView, signal: Double? ->
        view.setCloseSignal(signal ?: 0.0)
      }

      // React Native asks the view manager to add and remove Foldkit's
      // views. They go into the layer that slides, not into the row itself.
      GroupView<SwipeRowView> {
        AddChildView<View> { parent, child, index ->
          parent.content.addView(child, index)
        }
        GetChildCount { parent ->
          parent.content.childCount
        }
        GetChildViewAt<View> { parent, index ->
          parent.content.getChildAt(index)
        }
        RemoveChildViewAt { parent, index ->
          parent.content.removeViewAt(index)
        }
        RemoveChildView<View> { parent, child ->
          parent.content.removeView(child)
        }
      }

      // Called once after a batch of props has been set.
      OnViewDidUpdateProps { view: SwipeRowView ->
        view.propsDidChange()
      }
    }
  }
}
