// A row that slides sideways under the finger to show action tiles.
//
// This is Android's classic View system, no Compose. The row holds two
// layers: the action tiles at the back, and in front of them the content,
// which is whatever views Foldkit put inside the row. The row watches the
// finger, and once it is sure the finger is going sideways it takes the
// touch for itself and moves the content layer. The tiles are laid out by
// hand in the gap the content leaves.
//
// The file has five parts, in this order:
//   1. what the view is made of
//   2. the props JavaScript sets
//   3. the touch handling: when the row takes the touch, what it does while
//      the finger moves, where the row comes to rest when the finger lifts
//   4. the tiles: how they are built and laid out
//   5. accessibility, and the list of open rows shared by a group

package expo.modules.foldkitswipe

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.dynamicanimation.animation.FloatValueHolder
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import com.facebook.react.uimanager.events.NativeGestureUtil
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

@SuppressLint("ViewConstructor")
class SwipeRowView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  enum class Side(val value: String) {
    LEADING("leading"),
    TRAILING("trailing")
  }

  enum class Mode {
    TILES,
    STRIP,
    INFO;

    companion object {
      fun from(name: String?): Mode = when (name) {
        "strip" -> STRIP
        "info" -> INFO
        else -> TILES
      }
    }
  }

  /** A layer whose children are placed by someone else: React Native, or this file. */
  class ManualLayer(context: Context) : ViewGroup(context) {
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
      // Nothing. See the class comment.
    }
  }

  // ---- 1. What the view is made of ----

  // Events. Expo finds these by name: each must match a name in the
  // `Events(...)` list in FoldkitSwipeModule.kt.
  private val onSwipeOpened by EventDispatcher()
  private val onSwipeClosed by EventDispatcher()
  private val onActionTriggered by EventDispatcher()

  /** The tiles live here, behind the content. */
  private val actionsLayer = ManualLayer(context)

  /** Foldkit's views live here. This is the layer that slides. */
  val content = ManualLayer(context)

  /** Info mode shows this in place of tiles. */
  private val infoLabel = TextView(context)

  private var tiles: List<TextView> = emptyList()

  /** Which side `tiles` were built for. */
  private var tilesSide: Side? = null

  private val density = context.resources.displayMetrics.density
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var spring: SpringAnimation? = null
  private var fillAnimator: ValueAnimator? = null

  init {
    actionsLayer.visibility = View.INVISIBLE
    addView(actionsLayer)
    addView(content)

    infoLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    infoLabel.setTextColor(Color.GRAY)
    infoLabel.gravity = Gravity.CENTER_VERTICAL
    infoLabel.visibility = View.GONE
    actionsLayer.addView(infoLabel)

    SwipeRowRegistry.add(this)
  }

  // React Native gives the row its size. The two layers fill it. A plain
  // LinearLayout, which is what an Expo view is underneath, would stack
  // them side by side.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    actionsLayer.layout(0, 0, right - left, bottom - top)
    content.layout(0, 0, right - left, bottom - top)
    applyOffset()
  }

  // ---- 2. Props ----

  private var leadingActions: List<SwipeActionRecord> = emptyList()
  private var trailingActions: List<SwipeActionRecord> = emptyList()
  var allowsFullSwipe = true
  var group = ""
  private var mode = Mode.TILES

  /** In points, as JavaScript gave it. */
  private var cornerRadius = 0f
  private var isSwipeEnabled = true

  /** "auto", "ltr" or "rtl". */
  private var directionOverride = "auto"
  private var closeSignal: Double? = null

  /** Set by a prop that changes what the tiles look like. */
  private var needsRebuild = false

  /** Set by a prop that changes where an open row would rest. */
  private var needsClose = false

  // JavaScript may send the same value again on every draw. Each setter
  // below does nothing unless the value is really different, so a redraw
  // never disturbs a row that is open or moving.

  fun setActions(actions: List<SwipeActionRecord>, side: Side) {
    if (signature(actions) == signature(actions(side))) {
      return
    }
    if (side == Side.LEADING) {
      leadingActions = actions
    } else {
      trailingActions = actions
    }
    needsRebuild = true
  }

  /** Everything about a list of actions as one piece of text, to compare two lists. */
  private fun signature(actions: List<SwipeActionRecord>): String =
    actions.joinToString("\u001E") {
      listOf(it.key, it.label, it.symbol ?: "", it.role, it.tint ?: "").joinToString("\u001F")
    }

  fun setMode(newMode: Mode) {
    if (newMode == mode) {
      return
    }
    mode = newMode
    needsRebuild = true
    needsClose = true
  }

  fun setCornerRadius(radius: Float) {
    if (radius == cornerRadius) {
      return
    }
    cornerRadius = radius
    val pixels = radius * density
    content.outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setRoundRect(0, 0, view.width, view.height, pixels)
      }
    }
    content.clipToOutline = radius > 0f
    needsRebuild = true
  }

  fun setSwipeEnabled(isEnabled: Boolean) {
    isSwipeEnabled = isEnabled
    if (!isEnabled) {
      close(true)
    }
  }

  fun setDirectionOverride(direction: String) {
    if (direction == directionOverride) {
      return
    }
    // Close first: "which way is open" is worked out from the direction.
    close(false)
    directionOverride = direction
    needsRebuild = true
  }

  /** JavaScript closes the row by changing this number. */
  fun setCloseSignal(signal: Double) {
    val isFirst = closeSignal == null
    val hasChanged = closeSignal != signal
    closeSignal = signal
    if (!isFirst && hasChanged) {
      close(true)
    }
  }

  /** Called after a batch of props has been set. */
  fun propsDidChange() {
    if (!needsRebuild) {
      return
    }
    needsRebuild = false
    val mustClose = needsClose
    needsClose = false
    // The tiles on screen no longer match the props. They are built again
    // the next time they are laid out.
    tilesSide = null
    updateAccessibilityActions()
    val side = sideFor(offset)
    val resting = openSide
    if (side != null && (mustClose || actions(side).isEmpty())) {
      close(false)
    } else if (spring == null && resting != null) {
      // The number of tiles may have changed, and with it where "open" is.
      settle(resting, 0f)
    } else {
      applyOffset()
    }
  }

  // ---- 3. The touch handling ----

  /**
   * How far the content has moved, in pixels. More than zero shows the
   * leading actions, less than zero the trailing ones. It is "logical": in
   * a right-to-left layout the content moves the other way on screen.
   */
  private var offset = 0f

  /** The side the row rests open on, or null when it rests closed. */
  private var openSide: Side? = null
  private var offsetAtDragStart = 0f
  private var openSideAtDragStart: Side? = null

  /** True while the finger is past the point where letting go triggers the first action. */
  private var isFullSwipeArmed = false

  /** From 0 to 1: how far the filling tile has grown. Follows `isFullSwipeArmed`. */
  private var fill = 0f

  /** True after a destructive action has slid the content off the row. */
  private var isSlidAway = false

  /** Which tile grows to fill the gap. The first, unless another was pressed. */
  private var fillingIndex = 0

  private var downX = 0f
  private var downY = 0f
  private var dragStartX = 0f
  private var isDragging = false

  /** True once this touch has turned out to be a vertical one. */
  private var hasGivenUp = false

  /** True when the finger came down on the content of an open row. */
  private var isClosingTouch = false
  private var velocityTracker: VelocityTracker? = null

  private val isRightToLeft: Boolean
    get() = when (directionOverride) {
      "rtl" -> true
      "ltr" -> false
      else -> layoutDirection == View.LAYOUT_DIRECTION_RTL
    }

  /** Turns a movement on screen into a logical one, and back. */
  private val directionSign: Float
    get() = if (isRightToLeft) -1f else 1f

  private fun actions(side: Side): List<SwipeActionRecord> =
    if (side == Side.LEADING) leadingActions else trailingActions

  private fun sideFor(value: Float): Side? = when {
    value > 0f -> Side.LEADING
    value < 0f -> Side.TRAILING
    else -> null
  }

  private fun canFullSwipe(side: Side): Boolean =
    allowsFullSwipe && mode != Mode.INFO && actions(side).isNotEmpty()

  /** How far the finger must go to arm a full swipe. */
  private fun fullSwipeDistance(side: Side): Float =
    max(openWidth(side) + 56f * density, width * 0.6f)

  /** Whether a point across the row is on the content, where the content is now. */
  private fun isOnContent(x: Float): Boolean {
    val left = content.translationX
    return x >= left && x <= left + content.width
  }

  // Android shows every touch to the views above the one touched, before
  // the touched view gets it. Returning true here takes the touch away from
  // the Foldkit views inside the row, for the rest of this finger's visit.
  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    if (!isSwipeEnabled || isSlidAway) {
      return false
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        beginTouch(event)
        if (isClosingTouch) {
          // An open row: the touch is the row's, to close it or to drag it.
          // Tell React Native so no button inside shows as pressed.
          NativeGestureUtil.notifyNativeGestureStarted(this, event)
          return true
        }
      }
      MotionEvent.ACTION_MOVE -> {
        velocityTracker?.addMovement(event)
        if (shouldStartDrag(event)) {
          startDrag(event)
          return true
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> endTouch()
    }
    return false
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!isSwipeEnabled || isSlidAway) {
      return super.onTouchEvent(event)
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        // Nothing inside the row wanted the touch. Keep watching it.
        if (velocityTracker == null) {
          beginTouch(event)
        }
      }
      MotionEvent.ACTION_MOVE -> {
        velocityTracker?.addMovement(event)
        if (!isDragging && shouldStartDrag(event)) {
          startDrag(event)
        }
        if (isDragging) {
          val moved = (event.x - dragStartX) * directionSign
          offset = resisted(offsetAtDragStart + moved)
          updateFullSwipeArmed()
          applyOffset()
        }
      }
      MotionEvent.ACTION_UP -> {
        if (isDragging) {
          velocityTracker?.addMovement(event)
          velocityTracker?.computeCurrentVelocity(1000)
          val velocity = (velocityTracker?.xVelocity ?: 0f) * directionSign
          NativeGestureUtil.notifyNativeGestureEnded(this, event)
          finishDrag(velocity)
        } else if (isClosingTouch) {
          NativeGestureUtil.notifyNativeGestureEnded(this, event)
          close(true)
        }
        endTouch()
      }
      MotionEvent.ACTION_CANCEL -> {
        if (isDragging) {
          // Something took the touch away. Go back to where the row was
          // before the finger came down.
          NativeGestureUtil.notifyNativeGestureEnded(this, event)
          setArmed(false)
          settle(openSideAtDragStart, 0f)
        }
        endTouch()
      }
    }
    return true
  }

  private fun beginTouch(event: MotionEvent) {
    downX = event.x
    downY = event.y
    isDragging = false
    hasGivenUp = false
    isClosingTouch = openSide != null && isOnContent(event.x)
    velocityTracker?.recycle()
    velocityTracker = VelocityTracker.obtain()
    velocityTracker?.addMovement(event)
  }

  private fun endTouch() {
    isDragging = false
    isClosingTouch = false
    velocityTracker?.recycle()
    velocityTracker = null
  }

  // The row takes the touch only when the finger has moved further than
  // the phone's "this is a drag" distance, more sideways than up or down,
  // and towards a side that has actions. A touch that starts out vertical
  // is left alone for good, which keeps the list scrolling.
  private fun shouldStartDrag(event: MotionEvent): Boolean {
    if (isDragging || hasGivenUp) {
      return false
    }
    val dx = event.x - downX
    val dy = event.y - downY
    if (abs(dy) > touchSlop && abs(dy) >= abs(dx)) {
      hasGivenUp = true
      return false
    }
    if (abs(dx) <= touchSlop || abs(dx) <= abs(dy)) {
      return false
    }
    if (openSide != null || spring != null) {
      return true
    }
    val towards = if (dx * directionSign > 0f) Side.LEADING else Side.TRAILING
    return actions(towards).isNotEmpty()
  }

  private fun startDrag(event: MotionEvent) {
    isDragging = true
    // The list around the row must not start scrolling now.
    parent?.requestDisallowInterceptTouchEvent(true)
    // React Native sends "touch cancelled" to JavaScript, which lets go of
    // any pressed button. Its own scroll view does the same.
    NativeGestureUtil.notifyNativeGestureStarted(this, event)
    SwipeRowRegistry.closeAll(group, this)
    stopAnimation()
    dragStartX = event.x
    offsetAtDragStart = offset
    openSideAtDragStart = openSide
  }

  /**
   * The offset the content really takes for a finger at `raw`. Past the
   * open position the row follows the finger more and more slowly, unless
   * a full swipe is possible, where it keeps following.
   */
  private fun resisted(raw: Float): Float {
    val side = sideFor(raw) ?: return 0f
    if (actions(side).isEmpty()) {
      return 0f
    }
    val distance = abs(raw)
    val open = openWidth(side)
    var result = distance
    if (!canFullSwipe(side) && distance > open) {
      result = open + (distance - open) * 0.25f
    }
    return if (side == Side.LEADING) result else -result
  }

  private fun updateFullSwipeArmed() {
    val side = sideFor(offset)
    val isArmed = side != null && canFullSwipe(side) && abs(offset) > fullSwipeDistance(side)
    if (isArmed == isFullSwipeArmed) {
      return
    }
    // A tick in the hand at the moment letting go would trigger the action.
    performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
    setArmed(isArmed)
  }

  /** The filling tile grows to fill the gap, or shrinks back, over a moment. */
  private fun setArmed(isArmed: Boolean) {
    isFullSwipeArmed = isArmed
    val target = if (isArmed) 1f else 0f
    fillAnimator?.cancel()
    if (fill == target) {
      return
    }
    val animator = ValueAnimator.ofFloat(fill, target)
    animator.setDuration(160L)
    animator.addUpdateListener {
      fill = it.animatedValue as Float
      layoutActions()
    }
    fillAnimator = animator
    animator.start()
  }

  /** The finger has lifted. `velocity` is in pixels per second, logical. */
  private fun finishDrag(velocity: Float) {
    val side = sideFor(offset)
    if (side == null) {
      settle(null, velocity)
      return
    }
    val first = actions(side).firstOrNull()
    if (isFullSwipeArmed && first != null) {
      trigger(first, side, true)
      return
    }
    if (mode == Mode.INFO) {
      // Information is only shown while the finger holds the row.
      settle(null, velocity)
      return
    }
    // Where the row would be a fifth of a second from now at this speed. A
    // quick flick opens or closes the row from anywhere.
    val outward = if (side == Side.LEADING) velocity else -velocity
    val projected = abs(offset) + outward * 0.2f
    settle(if (projected > openWidth(side) / 2f) side else null, velocity)
  }

  /** Closes the row. Other rows of the group and JavaScript call this. */
  fun close(animated: Boolean) {
    if (offset == 0f && openSide == null && spring == null) {
      return
    }
    if (isDragging) {
      // Ends the drag in progress, and ignores the rest of that touch.
      isDragging = false
      hasGivenUp = true
    }
    isSlidAway = false
    fillingIndex = 0
    setArmed(false)
    if (animated) {
      settle(null, 0f)
    } else {
      stopAnimation()
      offset = 0f
      setResting(null)
      applyOffset()
    }
  }

  /** Springs the row to rest open on `side`, or closed for null. */
  private fun settle(side: Side?, velocity: Float) {
    val target = when (side) {
      Side.LEADING -> openWidth(side)
      Side.TRAILING -> -openWidth(side)
      null -> 0f
    }
    setResting(side)
    animateTo(target, velocity)
  }

  /** Remembers where the row rests and tells JavaScript when that changed. */
  private fun setResting(side: Side?) {
    val before = openSide
    openSide = side
    if (before == side) {
      return
    }
    if (side != null) {
      onSwipeOpened(mapOf("side" to side.value))
    } else {
      onSwipeClosed(emptyMap())
    }
  }

  // The spring starts at the speed the finger had, so the row carries on in
  // one movement.
  private fun animateTo(target: Float, velocity: Float) {
    stopAnimation()
    if (abs(target - offset) < 0.5f) {
      offset = target
      applyOffset()
      return
    }
    val force = SpringForce(target).setDampingRatio(0.86f).setStiffness(420f)
    val running = SpringAnimation(FloatValueHolder(offset))
    running.setSpring(force)
    running.setStartVelocity(velocity)
    running.addUpdateListener { _, value, _ ->
      offset = value
      applyOffset()
    }
    running.addEndListener { animation, canceled, _, _ ->
      if (spring === animation) {
        spring = null
        if (!canceled) {
          offset = target
          applyOffset()
        }
      }
    }
    spring = running
    running.start()
  }

  /** Stops a running animation where it is, so a new finger can take over. */
  private fun stopAnimation() {
    val running = spring ?: return
    spring = null
    running.cancel()
  }

  /** Sends the action to JavaScript and moves the row out of the way. */
  private fun trigger(action: SwipeActionRecord, side: Side, viaFullSwipe: Boolean) {
    onActionTriggered(mapOf("key" to action.key, "viaFullSwipe" to viaFullSwipe))
    if (action.role != "destructive") {
      setArmed(false)
      settle(null, 0f)
      return
    }
    // The content slides off and the tile fills the row. JavaScript is
    // expected to remove the row. Should it stay, it comes back.
    fillingIndex = max(0, actions(side).indexOfFirst { it.key == action.key })
    isSlidAway = true
    setArmed(true)
    setResting(null)
    animateTo(if (side == Side.LEADING) width.toFloat() else -width.toFloat(), 0f)
    postDelayed({
      if (isSlidAway) {
        close(true)
      }
    }, 700)
  }

  // ---- 4. The tiles ----

  private val tileWidth = 74f * density
  private val gap: Float
    get() = if (mode == Mode.TILES) 8f * density else 0f

  /** How far the content rests from its closed place when open on `side`. */
  private fun openWidth(side: Side): Float {
    val count = actions(side).size
    if (count == 0) {
      return 0f
    }
    if (mode == Mode.INFO) {
      val widest = actions(side).maxOf { infoLabel.paint.measureText(it.label) }
      return min(width * 0.7f, widest + 32f * density)
    }
    return count * tileWidth + (count + 1) * gap
  }

  /** Puts the content and the tiles where `offset` says. */
  private fun applyOffset() {
    content.translationX = offset * directionSign
    layoutActions()
  }

  private fun layoutActions() {
    val side = sideFor(offset)
    if (side == null) {
      actionsLayer.visibility = View.INVISIBLE
      return
    }
    actionsLayer.visibility = View.VISIBLE
    if (tilesSide != side) {
      rebuildTiles(side)
    }
    val shown = abs(offset)
    // The leading side is on the left, unless the layout is right-to-left.
    val isOnLeft = (side == Side.LEADING) != isRightToLeft

    if (mode == Mode.INFO) {
      val pad = 16f * density
      val labelWidth = max(shown - 2 * pad, 0f)
      val left = if (isOnLeft) pad else width - shown + pad
      place(infoLabel, left, 0f, labelWidth, height.toFloat())
      infoLabel.alpha = min(1f, shown / (60f * density))
      return
    }

    val count = tiles.size
    if (count == 0) {
      return
    }
    val open = openWidth(side)
    val progress = if (open > 0f) min(1f, shown / open) else 1f
    val inset = gap
    var eachWidth = tileWidth
    if (mode == Mode.STRIP) {
      // Square blocks that share the gap equally at every moment.
      eachWidth = shown / count
    } else if (shown > open) {
      // Dragged past open: the tiles stretch to keep the gap filled.
      eachWidth = (shown - (count + 1) * inset) / count
    }
    tiles.forEachIndexed { index, tile ->
      // Measured from the outer edge of the row. In tiles mode the tiles
      // start stacked under the content and spread apart as it moves away.
      var fromEdge = inset + index * (eachWidth + inset)
      var tileW = eachWidth
      var alpha = 1f
      if (mode == Mode.TILES && shown <= open) {
        fromEdge *= progress
      }
      if (fill > 0f) {
        // One tile grows to fill the gap. The others fade.
        if (index == fillingIndex) {
          fromEdge += (inset - fromEdge) * fill
          tileW += (max(shown - 2 * inset, 0f) - tileW) * fill
        } else {
          alpha = 1f - fill
        }
      }
      val left = if (isOnLeft) fromEdge else width - fromEdge - tileW
      place(tile, left, inset, max(tileW, 0f), max(height - 2 * inset, 0f))
      tile.alpha = alpha
    }
  }

  /** Gives a view its size and place. React Native never lays these out. */
  private fun place(view: View, left: Float, top: Float, viewWidth: Float, viewHeight: Float) {
    val w = viewWidth.toInt()
    val h = viewHeight.toInt()
    view.measure(
      MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)
    )
    val x = left.toInt()
    val y = top.toInt()
    view.layout(x, y, x + w, y + h)
  }

  private fun rebuildTiles(side: Side) {
    tiles.forEach { actionsLayer.removeView(it) }
    tilesSide = side
    infoLabel.visibility = if (mode == Mode.INFO) View.VISIBLE else View.GONE
    if (mode == Mode.INFO) {
      tiles = emptyList()
      infoLabel.text = actions(side).joinToString("\n") { it.label }
      return
    }
    val radius = when {
      mode != Mode.TILES -> 0f
      cornerRadius > 0f -> cornerRadius * density
      else -> 12f * density
    }
    val built = actions(side).map { action ->
      val tile = TextView(context)
      tile.text = action.label
      tile.setTextColor(Color.WHITE)
      tile.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      tile.typeface = Typeface.DEFAULT_BOLD
      tile.gravity = Gravity.CENTER
      tile.maxLines = 1
      val background = GradientDrawable()
      background.setColor(colorFor(action))
      background.cornerRadius = radius
      tile.background = background
      // What TalkBack reads when a finger lands on the tile.
      tile.contentDescription = action.label
      tile.setOnClickListener { trigger(action, side, false) }
      tile
    }
    // Added last to first, so the first tile is on top when they overlap.
    built.asReversed().forEach { actionsLayer.addView(it) }
    tiles = built
  }

  private fun colorFor(action: SwipeActionRecord): Int {
    val tint = action.tint
    if (tint != null) {
      try {
        return Color.parseColor(tint)
      } catch (error: IllegalArgumentException) {
        // Not a colour Android can read. The role decides.
      }
    }
    return when (action.role) {
      "destructive" -> Color.rgb(220, 38, 38)
      "cancel" -> Color.rgb(113, 113, 122)
      else -> Color.rgb(37, 99, 235)
    }
  }

  // ---- 5. Accessibility and the group ----

  private val accessibilityActionIds = mutableListOf<Int>()

  // TalkBack offers these in its actions menu when it is on the row.
  private fun updateAccessibilityActions() {
    accessibilityActionIds.forEach { ViewCompat.removeAccessibilityAction(this, it) }
    accessibilityActionIds.clear()
    if (mode != Mode.INFO) {
      for (side in listOf(Side.TRAILING, Side.LEADING)) {
        for (action in actions(side)) {
          val id = ViewCompat.addAccessibilityAction(this, action.label) { _, _ ->
            trigger(action, side, false)
            true
          }
          if (id != View.NO_ID) {
            accessibilityActionIds.add(id)
          }
        }
      }
    }
    // TalkBack must be able to land on the row as a whole to offer them.
    ViewCompat.setScreenReaderFocusable(this, accessibilityActionIds.isNotEmpty())
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stopAnimation()
    fillAnimator?.cancel()
    endTouch()
  }
}

/**
 * Every swipe row alive in the app, so that opening one can close the
 * others of its group. It holds the rows weakly: a row that is removed from
 * the screen drops out by itself. Main thread only.
 */
object SwipeRowRegistry {
  private val rows: MutableSet<SwipeRowView> = Collections.newSetFromMap(WeakHashMap())

  fun add(row: SwipeRowView) {
    rows.add(row)
  }

  /** Closes the open rows of a group. A row with no group is alone. */
  fun closeAll(group: String, except: SwipeRowView?) {
    if (group.isEmpty()) {
      return
    }
    for (row in rows.toList()) {
      if (row !== except && row.group == group) {
        row.close(true)
      }
    }
  }
}
