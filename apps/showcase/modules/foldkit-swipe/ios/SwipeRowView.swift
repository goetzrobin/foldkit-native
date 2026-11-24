// A row that slides sideways under the finger to show action tiles.
//
// This is plain UIKit. The row holds two layers: the action tiles at the
// back, and in front of them the content, which is whatever views Foldkit
// put inside the row. A pan gesture recogniser moves the content layer. The
// tiles are laid out by hand in the gap the content leaves.
//
// The file has five parts, in this order:
//   1. what the view is made of, and how Foldkit's views get inside it
//   2. the props JavaScript sets
//   3. the gesture: when it may begin, what it does while it moves, where
//      the row comes to rest when the finger lifts
//   4. the tiles: how they are built and laid out
//   5. accessibility, and the list of open rows shared by a group

import ExpoModulesCore
import UIKit

public final class SwipeRowView: ExpoView, UIGestureRecognizerDelegate {
  enum Side: String {
    case leading
    case trailing
  }

  enum Mode: String {
    case tiles
    case strip
    case info
  }

  // MARK: - 1. What the view is made of

  // Events. Expo finds these by name: each must match a name in the
  // `Events(...)` list in FoldkitSwipeModule.swift.
  let onSwipeOpened = EventDispatcher()
  let onSwipeClosed = EventDispatcher()
  let onActionTriggered = EventDispatcher()

  /// The tiles live here, behind the content.
  private let actionsLayer = UIView()
  /// Foldkit's views live here. This is the layer that slides.
  private let contentLayer = UIView()
  /// Info mode shows this in place of tiles.
  private let infoLabel = UILabel()

  private var tiles: [SwipeTile] = []
  /// Which side `tiles` were built for.
  private var tilesSide: Side?

  private let pan = UIPanGestureRecognizer()
  private let tap = UITapGestureRecognizer()
  private let haptic = UIImpactFeedbackGenerator(style: .medium)
  private var animator: UIViewPropertyAnimator?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    actionsLayer.isHidden = true
    addSubview(actionsLayer)

    contentLayer.clipsToBounds = true
    addSubview(contentLayer)

    infoLabel.numberOfLines = 0
    infoLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
    infoLabel.textColor = UIColor.secondaryLabel
    infoLabel.isHidden = true
    actionsLayer.addSubview(infoLabel)

    pan.addTarget(self, action: #selector(handlePan(_:)))
    pan.maximumNumberOfTouches = 1
    pan.delegate = self
    addGestureRecognizer(pan)

    // A tap on the content of an open row closes it.
    tap.addTarget(self, action: #selector(handleTap(_:)))
    tap.delegate = self
    tap.isEnabled = false
    addGestureRecognizer(tap)

    SwipeRowRegistry.add(self)
  }

  // React Native calls these two to put Foldkit's views inside this view and
  // to take them out. They go into the layer that slides.
  public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    contentLayer.insertSubview(childComponentView, at: index)
  }

  public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    actionsLayer.frame = bounds
    // A running animation owns the frames until it ends.
    if animator == nil {
      applyOffset()
    }
  }

  // MARK: - 2. Props

  private var leadingActions: [SwipeActionRecord] = []
  private var trailingActions: [SwipeActionRecord] = []
  var allowsFullSwipe = true
  var group = ""
  private var mode: Mode = .tiles
  private var cornerRadius: CGFloat = 0
  private var isSwipeEnabled = true
  /// "auto", "ltr" or "rtl".
  private var directionOverride = "auto"
  private var closeSignal: Double?
  /// Set by a prop that changes what the tiles look like.
  private var needsRebuild = false
  /// Set by a prop that changes where an open row would rest.
  private var needsClose = false

  // JavaScript may send the same value again on every draw. Each setter
  // below does nothing unless the value is really different, so a redraw
  // never disturbs a row that is open or moving.

  func setActions(_ actions: [SwipeActionRecord], side: Side) {
    guard SwipeRowView.signature(of: actions) != SwipeRowView.signature(of: self.actions(for: side)) else {
      return
    }
    if side == .leading {
      leadingActions = actions
    } else {
      trailingActions = actions
    }
    needsRebuild = true
  }

  /// Everything about a list of actions as one piece of text, to compare two lists.
  private static func signature(of actions: [SwipeActionRecord]) -> String {
    return actions
      .map { [$0.key, $0.label, $0.symbol ?? "", $0.role, $0.tint ?? ""].joined(separator: "\u{1F}") }
      .joined(separator: "\u{1E}")
  }

  func setMode(_ newMode: Mode) {
    guard newMode != mode else {
      return
    }
    mode = newMode
    needsRebuild = true
    needsClose = true
  }

  func setCornerRadius(_ radius: CGFloat) {
    guard radius != cornerRadius else {
      return
    }
    cornerRadius = radius
    contentLayer.layer.cornerRadius = radius
    needsRebuild = true
  }

  func setSwipeEnabled(_ isEnabled: Bool) {
    isSwipeEnabled = isEnabled
    if !isEnabled {
      close(animated: true)
    }
  }

  func setDirectionOverride(_ direction: String) {
    guard direction != directionOverride else {
      return
    }
    // Close first: "which way is open" is worked out from the direction.
    close(animated: false)
    directionOverride = direction
    needsRebuild = true
  }

  /// JavaScript closes the row by changing this number.
  func setCloseSignal(_ signal: Double) {
    let isFirst = closeSignal == nil
    let hasChanged = closeSignal != signal
    closeSignal = signal
    if !isFirst && hasChanged {
      close(animated: true)
    }
  }

  /// Called after a batch of props has been set.
  func propsDidChange() {
    guard needsRebuild else {
      return
    }
    needsRebuild = false
    let mustClose = needsClose
    needsClose = false
    // The tiles on screen no longer match the props. They are built again
    // the next time they are laid out.
    tilesSide = nil
    updateAccessibilityActions()
    if let side = revealedSide(at: offset), mustClose || actions(for: side).isEmpty {
      close(animated: false)
    } else if animator != nil {
      // An animation is running. Swap the tiles under it without joining it.
      UIView.performWithoutAnimation {
        layoutActions()
      }
    } else if let side = openSide {
      // The number of tiles may have changed, and with it where "open" is.
      settle(to: side, velocity: 0)
    } else {
      applyOffset()
    }
  }

  // MARK: - 3. The gesture

  /// How far the content has moved, in points. More than zero shows the
  /// leading actions, less than zero the trailing ones. It is "logical": in
  /// a right-to-left layout the content moves the other way on screen.
  private var offset: CGFloat = 0
  /// The side the row rests open on, or nil when it rests closed.
  private var openSide: Side?
  private var offsetAtPanStart: CGFloat = 0
  private var openSideAtPanStart: Side?
  /// True while the finger is past the point where letting go triggers the
  /// first action.
  private var isFullSwipeArmed = false
  /// True after a destructive action has slid the content off the row.
  private var isSlidAway = false
  /// Which tile grows to fill the gap. The first, unless another was pressed.
  private var fillingIndex = 0

  private var isRightToLeft: Bool {
    switch directionOverride {
    case "rtl":
      return true
    case "ltr":
      return false
    default:
      return effectiveUserInterfaceLayoutDirection == .rightToLeft
    }
  }

  /// Turns a movement on screen into a logical one, and back.
  private var directionSign: CGFloat {
    return isRightToLeft ? -1 : 1
  }

  private func actions(for side: Side) -> [SwipeActionRecord] {
    return side == .leading ? leadingActions : trailingActions
  }

  private func revealedSide(at value: CGFloat) -> Side? {
    if value > 0 {
      return .leading
    }
    if value < 0 {
      return .trailing
    }
    return nil
  }

  private func canFullSwipe(_ side: Side) -> Bool {
    return allowsFullSwipe && mode != .info && !actions(for: side).isEmpty
  }

  /// How far past the open position the finger must go to arm a full swipe.
  private func fullSwipeDistance(for side: Side) -> CGFloat {
    return max(openWidth(for: side) + 56, bounds.width * 0.6)
  }

  // The pan may begin only when the finger moves more sideways than up or
  // down, and only towards a side that has actions. Saying no here is what
  // leaves vertical drags to the scroll view around the row.
  public override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === pan else {
      return super.gestureRecognizerShouldBegin(gestureRecognizer)
    }
    guard isSwipeEnabled, !isSlidAway else {
      return false
    }
    // Which way the finger is going: its speed, or where there is no speed
    // yet, how far it has come.
    var heading = pan.velocity(in: self)
    if heading == .zero {
      heading = pan.translation(in: self)
    }
    guard abs(heading.x) > abs(heading.y) else {
      return false
    }
    if openSide != nil || animator != nil {
      return true
    }
    let towards: Side = heading.x * directionSign > 0 ? .leading : .trailing
    return !actions(for: towards).isEmpty
  }

  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    // Either the row slides or the list scrolls, never both.
    return false
  }

  // The scroll view around the row waits until this pan has said no.
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    return gestureRecognizer === pan
      && otherGestureRecognizer is UIPanGestureRecognizer
      && otherGestureRecognizer.view is UIScrollView
  }

  // The swipe from the screen's edge that goes back a screen comes first.
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    return gestureRecognizer === pan && otherGestureRecognizer is UIScreenEdgePanGestureRecognizer
  }

  public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    if gestureRecognizer === tap {
      // A tap on a tile is the tile's, not a request to close.
      return !(touch.view?.isDescendant(of: actionsLayer) ?? false)
    }
    return true
  }

  // While the row is open, a touch on the content belongs to the row (to
  // close it or drag it), not to a button inside the content.
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if openSide != nil && isUserInteractionEnabled && !isHidden && contentLayer.frame.contains(point) {
      return self
    }
    return super.hitTest(point, with: event)
  }

  @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
    switch recognizer.state {
    case .began:
      // The finger went down on a Foldkit view, which may already show
      // itself as pressed. Tell React Native the touch is no longer its own.
      cancelReactTouches()
      SwipeRowRegistry.closeAll(group: group, except: self)
      stopAnimation()
      offsetAtPanStart = offset
      openSideAtPanStart = openSide
      haptic.prepare()
    case .changed:
      let moved = recognizer.translation(in: self).x * directionSign
      offset = resisted(offsetAtPanStart + moved)
      updateFullSwipeArmed()
      applyOffset()
    case .ended:
      finishPan(velocity: recognizer.velocity(in: self).x * directionSign)
    case .cancelled, .failed:
      // Something took the touch away (a phone call, an alert). Go back to
      // where the row was before the finger came down.
      isFullSwipeArmed = false
      settle(to: openSideAtPanStart, velocity: 0)
    default:
      break
    }
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    close(animated: true)
  }

  /// The offset the content really takes for a finger at `raw`. Past the
  /// open position the row follows the finger more and more slowly, unless
  /// a full swipe is possible, where it keeps following.
  private func resisted(_ raw: CGFloat) -> CGFloat {
    guard let side = revealedSide(at: raw), !actions(for: side).isEmpty else {
      return 0
    }
    let distance = abs(raw)
    let open = openWidth(for: side)
    var result = distance
    if !canFullSwipe(side) && distance > open {
      result = open + (distance - open) * 0.25
    }
    return side == .leading ? result : -result
  }

  private func updateFullSwipeArmed() {
    var isArmed = false
    if let side = revealedSide(at: offset), canFullSwipe(side) {
      isArmed = abs(offset) > fullSwipeDistance(for: side)
    }
    guard isArmed != isFullSwipeArmed else {
      return
    }
    isFullSwipeArmed = isArmed
    // A tick in the hand at the moment letting go would trigger the action.
    haptic.impactOccurred()
    haptic.prepare()
    // The first tile grows to fill, or shrinks back.
    UIView.animate(withDuration: 0.2) {
      self.layoutActions()
    }
  }

  /// The finger has lifted. `velocity` is in points per second and logical,
  /// like `offset`: more than zero moves towards showing the leading actions.
  private func finishPan(velocity: CGFloat) {
    guard let side = revealedSide(at: offset) else {
      settle(to: nil, velocity: velocity)
      return
    }
    if isFullSwipeArmed, let first = actions(for: side).first {
      trigger(first, side: side, viaFullSwipe: true)
      return
    }
    if mode == .info {
      // Information is only shown while the finger holds the row.
      settle(to: nil, velocity: velocity)
      return
    }
    // Where the row would be a fifth of a second from now at this speed. A
    // quick flick opens or closes the row from anywhere.
    let outward = side == .leading ? velocity : -velocity
    let projected = abs(offset) + outward * 0.2
    settle(to: projected > openWidth(for: side) / 2 ? side : nil, velocity: velocity)
  }

  /// Closes the row. Other rows of the group and JavaScript call this.
  func close(animated: Bool) {
    guard offset != 0 || openSide != nil || animator != nil else {
      return
    }
    if pan.state == .began || pan.state == .changed {
      // Ends the drag in progress. Its `.cancelled` must not reopen the row.
      openSideAtPanStart = nil
      pan.isEnabled = false
      pan.isEnabled = true
    }
    isFullSwipeArmed = false
    isSlidAway = false
    fillingIndex = 0
    if animated {
      settle(to: nil, velocity: 0)
    } else {
      stopAnimation()
      offset = 0
      setResting(nil)
      applyOffset()
    }
  }

  /// Springs the row to rest open on `side`, or closed for nil.
  private func settle(to side: Side?, velocity: CGFloat) {
    var target: CGFloat = 0
    if let side = side {
      target = side == .leading ? openWidth(for: side) : -openWidth(for: side)
    }
    setResting(side)
    animate(to: target, velocity: velocity)
  }

  /// Remembers where the row rests and tells JavaScript when that changed.
  private func setResting(_ side: Side?) {
    let before = openSide
    openSide = side
    tap.isEnabled = side != nil
    guard before != side else {
      return
    }
    if let side = side {
      onSwipeOpened(["side": side.rawValue])
    } else {
      onSwipeClosed()
    }
  }

  private func animate(to target: CGFloat, velocity: CGFloat) {
    stopAnimation()
    let distance = target - offset
    offset = target
    if UIAccessibility.isReduceMotionEnabled || abs(distance) < 0.5 {
      applyOffset()
      return
    }
    // The spring starts at the speed the finger had, so the row carries on
    // in one movement. UIKit wants that speed as a share of the distance.
    let timing = UISpringTimingParameters(
      dampingRatio: 0.86,
      initialVelocity: CGVector(dx: velocity / distance, dy: 0)
    )
    let running = UIViewPropertyAnimator(duration: 0.4, timingParameters: timing)
    running.addAnimations {
      self.applyOffset()
    }
    running.addCompletion { [weak self, weak running] _ in
      guard let self = self, let running = running, self.animator === running else {
        return
      }
      self.animator = nil
      self.applyOffset()
    }
    animator = running
    running.startAnimation()
  }

  /// Stops a running animation where it is, so a new finger can take over.
  private func stopAnimation() {
    guard let running = animator else {
      return
    }
    animator = nil
    running.stopAnimation(true)
    // The views now sit where the animation had got to. Read that back.
    offset = contentLayer.frame.origin.x * directionSign
  }

  /// Sends the action to JavaScript and moves the row out of the way.
  private func trigger(_ action: SwipeActionRecord, side: Side, viaFullSwipe: Bool) {
    onActionTriggered(["key": action.key, "viaFullSwipe": viaFullSwipe])
    guard action.role == "destructive" else {
      isFullSwipeArmed = false
      settle(to: nil, velocity: 0)
      return
    }
    // The content slides off and the tile fills the row. JavaScript is
    // expected to remove the row. Should it stay, it comes back.
    isFullSwipeArmed = true
    isSlidAway = true
    fillingIndex = actions(for: side).firstIndex { $0.key == action.key } ?? 0
    setResting(nil)
    animate(to: side == .leading ? bounds.width : -bounds.width, velocity: 0)
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 700_000_000)
      guard let self = self, self.isSlidAway else {
        return
      }
      self.close(animated: true)
    }
  }

  /// React Native's own touch handling is a gesture recogniser on one of
  /// the views above this one. Switching it off and on makes it send
  /// "touch cancelled" to JavaScript, which lets go of any pressed button.
  /// react-native-screens and react-native-gesture-handler do the same.
  private func cancelReactTouches() {
    guard let handlerClass = NSClassFromString("RCTSurfaceTouchHandler") else {
      return
    }
    var view: UIView? = self
    while let current = view {
      for recognizer in current.gestureRecognizers ?? [] where recognizer.isKind(of: handlerClass) {
        recognizer.isEnabled = false
        recognizer.isEnabled = true
      }
      view = current.superview
    }
  }

  // MARK: - 4. The tiles

  private static let tileWidth: CGFloat = 74
  private static let tileGap: CGFloat = 8

  private var gap: CGFloat {
    return mode == .tiles ? SwipeRowView.tileGap : 0
  }

  /// How far the content rests from its closed place when open on `side`.
  private func openWidth(for side: Side) -> CGFloat {
    let count = CGFloat(actions(for: side).count)
    if count == 0 {
      return 0
    }
    if mode == .info {
      let widest = infoText(for: side).size(withAttributes: [.font: infoLabel.font as Any]).width
      return min(max(bounds.width * 0.7, 0), ceil(widest) + 32)
    }
    return count * SwipeRowView.tileWidth + (count + 1) * gap
  }

  private func infoText(for side: Side) -> NSString {
    return actions(for: side).map { $0.label }.joined(separator: "\n") as NSString
  }

  /// Puts the content and the tiles where `offset` says.
  private func applyOffset() {
    contentLayer.frame = bounds.offsetBy(dx: offset * directionSign, dy: 0)
    layoutActions()
  }

  private func layoutActions() {
    guard let side = revealedSide(at: offset) else {
      actionsLayer.isHidden = true
      return
    }
    actionsLayer.isHidden = false
    if tilesSide != side {
      rebuildTiles(for: side)
    }
    let shown = abs(offset)
    // The leading side is on the left, unless the layout is right-to-left.
    let isOnLeft = (side == .leading) != isRightToLeft

    if mode == .info {
      let width = max(shown - 32, 0)
      infoLabel.frame = CGRect(
        x: isOnLeft ? 16 : bounds.width - shown + 16,
        y: 0,
        width: width,
        height: bounds.height
      )
      infoLabel.alpha = min(1, shown / 60)
      return
    }

    let count = CGFloat(tiles.count)
    guard count > 0 else {
      return
    }
    let open = openWidth(for: side)
    let progress = open > 0 ? min(1, shown / open) : 1
    let inset = gap
    var tileWidth = SwipeRowView.tileWidth
    if mode == .strip {
      // Square blocks that share the gap equally at every moment.
      tileWidth = shown / count
    } else if shown > open {
      // Dragged past open: the tiles stretch to keep the gap filled.
      tileWidth = (shown - (count + 1) * inset) / count
    }
    for (index, tile) in tiles.enumerated() {
      // Measured from the outer edge of the row. In tiles mode the tiles
      // start stacked under the content and spread apart as it moves away.
      var fromEdge = inset + CGFloat(index) * (tileWidth + inset)
      var width = tileWidth
      var alpha: CGFloat = 1
      if mode == .tiles && shown <= open {
        fromEdge *= progress
      }
      if isFullSwipeArmed {
        // One tile fills the gap. The others fade.
        if index == fillingIndex {
          fromEdge = inset
          width = max(shown - 2 * inset, 0)
        } else {
          alpha = 0
        }
      }
      tile.frame = CGRect(
        x: isOnLeft ? fromEdge : bounds.width - fromEdge - width,
        y: inset,
        width: max(width, 0),
        height: max(bounds.height - 2 * inset, 0)
      )
      tile.alpha = alpha
    }
  }

  private func rebuildTiles(for side: Side) {
    tiles.forEach { $0.removeFromSuperview() }
    tiles = []
    tilesSide = side
    infoLabel.isHidden = mode != .info
    if mode == .info {
      infoLabel.text = infoText(for: side) as String
      infoLabel.textAlignment = isRightToLeft ? .right : .left
      return
    }
    var radius: CGFloat = 0
    if mode == .tiles {
      radius = cornerRadius > 0 ? cornerRadius : 12
    }
    // Added last to first, so the first tile is on top when they overlap.
    for action in actions(for: side).reversed() {
      let tile = SwipeTile(action: action, cornerRadius: radius)
      tile.onPress = { [weak self] in
        self?.trigger(action, side: side, viaFullSwipe: false)
      }
      actionsLayer.addSubview(tile)
      tiles.insert(tile, at: 0)
    }
  }

  // MARK: - 5. Accessibility and the group

  private var customActions: [UIAccessibilityCustomAction] = []

  // VoiceOver offers these when it is on the row or on anything inside it
  // ("Actions available", then swipe up or down). React Native's base view
  // answers this itself, so the answer is replaced here, not assigned.
  public override var accessibilityCustomActions: [UIAccessibilityCustomAction]? {
    get {
      return customActions.isEmpty ? nil : customActions
    }
    set {
      customActions = newValue ?? []
    }
  }

  private func updateAccessibilityActions() {
    guard mode != .info else {
      customActions = []
      return
    }
    var result: [UIAccessibilityCustomAction] = []
    for side in [Side.trailing, Side.leading] {
      for action in actions(for: side) {
        result.append(
          UIAccessibilityCustomAction(name: action.label) { [weak self] _ in
            guard let self = self else {
              return false
            }
            self.trigger(action, side: side, viaFullSwipe: false)
            return true
          }
        )
      }
    }
    customActions = result
  }
}

/// One action tile: a coloured block with a symbol and a word.
final class SwipeTile: UIControl {
  var onPress: (() -> Void)?

  init(action: SwipeActionRecord, cornerRadius: CGFloat) {
    super.init(frame: .zero)
    backgroundColor = SwipeTile.color(for: action)
    layer.cornerRadius = cornerRadius
    layer.cornerCurve = .continuous
    clipsToBounds = true

    let stack = UIStackView()
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 4
    stack.isUserInteractionEnabled = false
    stack.translatesAutoresizingMaskIntoConstraints = false

    if let symbol = action.symbol, !symbol.isEmpty,
      let image = UIImage(
        systemName: symbol,
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
      ) {
      let icon = UIImageView(image: image)
      icon.tintColor = .white
      stack.addArrangedSubview(icon)
    }

    let label = UILabel()
    label.text = action.label
    label.textColor = .white
    label.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
    label.lineBreakMode = .byClipping
    stack.addArrangedSubview(label)

    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: centerYAnchor)
    ])

    addTarget(self, action: #selector(pressed), for: .touchUpInside)

    // What VoiceOver reads when a finger lands on the tile.
    isAccessibilityElement = true
    accessibilityLabel = action.label
    accessibilityTraits = .button
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var isHighlighted: Bool {
    didSet {
      alpha = isHighlighted ? 0.7 : 1
    }
  }

  @objc private func pressed() {
    onPress?()
  }

  private static func color(for action: SwipeActionRecord) -> UIColor {
    if let tint = action.tint, let color = UIColor(swipeHex: tint) {
      return color
    }
    switch action.role {
    case "destructive":
      return .systemRed
    case "cancel":
      return .systemGray
    default:
      return .systemBlue
    }
  }
}

extension UIColor {
  /// Reads "#rrggbb" or "#rrggbbaa". Anything else gives nil.
  convenience init?(swipeHex text: String) {
    var digits = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard digits.hasPrefix("#") else {
      return nil
    }
    digits.removeFirst()
    guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else {
      return nil
    }
    let hasAlpha = digits.count == 8
    let red = CGFloat((value >> (hasAlpha ? 24 : 16)) & 0xff) / 255
    let green = CGFloat((value >> (hasAlpha ? 16 : 8)) & 0xff) / 255
    let blue = CGFloat((value >> (hasAlpha ? 8 : 0)) & 0xff) / 255
    let alpha = hasAlpha ? CGFloat(value & 0xff) / 255 : 1
    self.init(red: red, green: green, blue: blue, alpha: alpha)
  }
}

/// Every swipe row alive in the app, so that opening one can close the
/// others of its group. It holds the rows weakly: a row that is removed
/// from the screen drops out by itself. Main thread only.
@MainActor
enum SwipeRowRegistry {
  private static let rows = NSHashTable<SwipeRowView>.weakObjects()

  static func add(_ row: SwipeRowView) {
    rows.add(row)
  }

  /// Closes the open rows of a group. A row with no group is alone.
  static func closeAll(group: String, except: SwipeRowView?) {
    guard !group.isEmpty else {
      return
    }
    for row in rows.allObjects where row !== except && row.group == group {
      row.close(animated: true)
    }
  }
}
