# Voice notes

Record a note, keep it on the phone, play it back. The first part is for a
reader who does not code. The appendix is for engineers.

The code is in `packages/native/src/device/` (`recorder.ts`, `player.ts`,
`voiceNotes.ts`, `audioNative.ts`). The demo is "Voice notes" in the showcase
menu. Nothing here has been seen or heard on a real phone yet. The questions
for a phone are V1 to V12 in `docs/PHONE_CHECKLIST.md`.

## What happens when you press Record

1. The program asks the phone for the microphone. The first time, the phone
   shows its own question. If you say no, the screen says so and nothing is
   recorded. If the phone will not ask again, an "Open Settings" button
   appears.
2. The program tells the phone how it wants sound handled: use the
   microphone, record even with the silent switch on, and keep going when the
   app is out of sight if the phone allows it.
3. The phone makes a recorder and starts it. The recorder is given the
   longest length (15 minutes) at the start, so the phone itself stops at
   that point even if the app is busy or asleep.
4. The phone taps once under your finger. The round button shows a timer.
5. Ten times a second the program asks the phone two things: how long is the
   recording, and how loud is the room. The bars under the button show the
   loudness.
6. A minute before the end, a line says how much time is left.

Pause holds the recording and the timer. Resume carries on in the same file.
"Stop and save" closes the file and adds it to the list. Discard closes the
file and deletes it.

## Where the file goes

While you record, the phone writes the sound into its cache, a folder it may
empty when it runs short of room. When you stop, the file is moved to a
folder called `voice-notes` in the app's documents. The phone keeps that
folder until the app is deleted.

Next to the sound files is one small text file, `index.json`. It is the list
you see on screen: each note's name, length, size, date and file name.
Renaming a note changes only this list. Deleting a note removes it from the
list and deletes its sound file.

A note is one channel of AAC sound in an `.m4a` file, about half a megabyte a
minute. A 15 minute note is about 7 megabytes.

## What the Model knows and what it does not

The Model is the program's memory of what the screen should show. It holds:

- the recorder's phase: Idle, AskingPermission, Recording, Paused, Saving or
  Failed,
- the seconds on the timer,
- the list of saved notes,
- which note is in the player, and how far it has played.

It changes about once a second while you record, when the timer moves.

It does not hold the loudness. Loudness changes all the time, and putting it
in the Model would redraw the whole screen ten times a second for the sake of
a few bars. So the recorder writes the loudness into a small box in memory,
and the meter reads that box when it draws itself. The rest of the screen is
left alone.

It does not hold the recording either. The recorder belongs to the app, and
the screen only asks it questions. That is why you can leave the Voice notes
screen while recording, look at another demo, come back, and find the timer
at the right second.

## When something gets in the way

**A phone call, or another app taking the sound.** The phone pauses the
recording by itself. The screen says "Paused by the phone". When the call
ends the phone may carry on by itself, and the screen says so. If it does
not, press Resume.

**The app goes out of sight, or the screen locks.** This depends on the
build. See the next section.

**The recording reaches 15 minutes.** The phone stops and the note is saved.
If the Voice notes screen was closed at that moment, the note is saved the
next time you open it.

**The phone's sound service crashes.** This is rare. The screen says the
recording broke. That recording is lost.

## Expo Go and a prebuilt app

Expo Go is the ready-made app you scan a QR code with. A prebuilt app is one
built for this project alone.

| | Expo Go | Prebuilt app |
|---|---|---|
| Recording and playing | Yes. Expo's documentation lists expo-audio as included in Expo Go. | Yes |
| Microphone question | Expo Go's own wording | Our wording, from `app.json` |
| Recording with the app out of sight or the screen locked | Not known. The program asks for it. If the phone refuses outright, it records in front only and the "Out of sight" line says "off". If the phone accepts but then pauses the recording anyway, the screen says "Paused by the phone" when you come back. V9 and V10 in the checklist find out. | Yes, by design: `app.json` switches on background recording for both platforms. On Android a notification shows while recording. Not yet seen on a phone. |
| Recording after the app is closed from the app switcher | No | No |

Three things are true in every build:

- If the phone does pause the recording out of sight, the timer on your
  return is the true length, because the timer always comes from the phone
  and never from the program's own clock.
- The 15 minute limit is kept by the phone, so it holds while the program is
  asleep.
- Closing the app from the app switcher ends the recording. What was
  recorded so far may be left in the cache as a file that is not in the
  list. This demo does not look for such files.

## What it would take to add upload and tagging

Nothing is uploaded in this demo. The screen has a line that says "Upload:
not built in this demo", and the code has two comments that say "UPLOAD GOES
HERE".

Adding it would mean four things:

1. A Command that sends one note's file to a server. Expo's file module has
   an upload function that reports progress.
2. A place in the list for each note's upload state: waiting, sending, sent,
   failed. It would be saved in `index.json` so that a note waiting to be
   sent is still waiting after the app restarts.
3. A rule for trying again: when the network comes back, and when the app
   opens. The project already has a network Subscription for this.
4. For tagging or a transcript, the server would answer later with the
   result. The note's entry in the list would grow a field for it, and the
   server-state tools in this project (see `docs/SERVER_STATE.md`) would
   keep it fresh.

The recorder, the player and the files would not change.

## Appendix for engineers

### Reaching expo-audio with no React

`expo-audio`'s JavaScript entry imports `react` for its hooks, so it is not
imported. The hooks only do three things with the native shared objects:
construct them, listen to them, and call `release()` on unmount
(`useReleasingSharedObject`). The same is done by hand.

| What | Exact name |
|---|---|
| Module | `globalThis.expo.modules.ExpoAudio` (what `requireNativeModule('ExpoAudio')` returns) |
| Recorder | `new ExpoAudio.AudioRecorder(options)` |
| Recorder methods | `prepareToRecordAsync()`, `record({ forDuration })`, `record()`, `pause()`, `stop()`, `getStatus()`, `addListener('recordingStatusUpdate', fn)`, `release()` |
| Player | `new ExpoAudio.AudioPlayer({ uri }, updateIntervalMs, keepAudioSessionActive, preferredForwardBufferDuration, allowsExternalPlayback)` |
| Player methods | `play()`, `pause()`, `seekTo(seconds)`, `setPlaybackRate(rate)`, `addListener('playbackStatusUpdate', fn)`, `remove()`, `release()` |
| Module functions | `setAudioModeAsync(mode)`, `getRecordingPermissionsAsync()`, `requestRecordingPermissionsAsync()` |
| Files | `globalThis.expo.modules.FileSystem`: `documentDirectory`, `new FileSystemFile(uri)` (`exists`, `size`, `textSync()`, `writeSync()`, `moveSync()`, `delete()`), `new FileSystemDirectory(uri)` (`exists`, `create()`) |
| Settings | `Linking.openSettings()` from `react-native` |

`src/device/audioNative.ts` holds these as TypeScript interfaces, the two
`...FromGlobal()` finders, and the test double `makeFakeAudio()`.

The entry file of `expo-audio` also wraps a few native methods. Skipping the
entry skips the wrappers, so their work is done by hand:

- `AudioRecorder.prototype.prepareToRecordAsync` and the hook flatten
  `{ ios, android }` options with `createRecordingOptions`. Here
  `recordingOptions(platform)` returns the flat shape.
- `AudioPlayer.prototype.replace` resolves asset numbers through
  `expo-asset`. Here a player is always made with `{ uri }` and never
  replaced, so `expo-asset` is not needed.
- `AudioPlayer.prototype.setPlaybackRate` drops the second argument on
  Android. Here it is always called with one.
- The exported `setAudioModeAsync` drops `allowsRecording` on Android. So
  does `modeFor`.

### What was read in expo-audio 58.0.12

- `recordingStatusUpdate` fires when a recording ends (finished, error,
  media services reset). It does not fire while recording. Progress comes
  from polling `getStatus()`, as `useAudioRecorderState` does. Polling is at
  100 ms. A Message goes out only when the whole second, the phase or the
  near-limit flag changes.
- After `stop()`, `getStatus().durationMillis` is 0 on both platforms. The
  length is read before `stop()`.
- `metering` is decibels: `averagePower` on iOS, `20 * log10(maxAmplitude /
  32767)` on Android, -160 for silence. `levelOf` maps -60..0 dB to 0..1.
- iOS interruption (`AVAudioSession.interruptionNotification`): the module
  calls `pauseForSystem()` on every recorder, and `resumeAfterSystemPause()`
  when the interruption ends with `shouldResume`. In both cases the recorder
  reports `isRecording: false, canRecord: true`. That pair is read as
  "paused by the phone". `isRecording: false, canRecord: false` is read as
  "the phone closed the file".
- Background, `allowsBackgroundRecording: false`: both platforms pause
  recorders on background and resume on foreground.
- Background, `allowsBackgroundRecording: true`: iOS needs
  `UIBackgroundModes: audio`. Android binds
  `expo.modules.audio.service.AudioRecordingService`, and `record()` throws
  `AudioRecordingServiceException` if the service is not bound. The recorder
  catches a failed start and starts again with the flag off.
- Android audio focus loss pauses players only. A phone call on Android does
  not pause a `MediaRecorder` through expo-audio. What the file then holds
  was not checked.
- iOS: `setAudioModeAsync` with `allowsRecording: false` stops every
  recorder. So the recorder and player share one `AudioSession` object, and
  the player refuses to start while a recording is live.
- iOS: `prepareToRecordAsync` makes a new `AVAudioRecorder` with a new file
  name, so the file address is read from `getStatus().url` after starting.

### Lifecycle

One native recorder per recording. It is released when the recording ends:
stop, cancel, limit, error, or a failed start. One native player at a time.
It is removed and released when another note is played, when its note is
deleted, when recording starts, and when the demo exits.

The recorder service is a closure made once in `Phone.live`. A recording in
progress is held there, so it outlives any one Foldkit program.
`Recorder.TakeSnapshot` is how a new program finds it. A recording that hits
its limit with no listener is kept as `unsaved` and handed out once by the
next snapshot.

### Tests

`packages/native/test/voice.test.ts`. The demo tests press the screen on
FakeFabric with `Phone.makeTest()`. The recorder, player and store under
test are the real code over `makeFakeAudio()` and in-memory files. Time is
the fake module's own clock (`audio.advance(ms)`), which moves the fake
recordings and the recorder's polling timer together. Effect's `TestClock`
is not used, because no Command in this feature sleeps.

### Not done

- No recovery of a recording orphaned in the cache by an app kill.
- No waveform is stored with a note. The meter is live only.
- No lock screen controls for playback, and playback stops in the
  background (`shouldPlayInBackground: false`).
- No choice of microphone (`getAvailableInputs`, `setInput`).
- The scrubber is twelve blocks you press, since the adapter has no slider.
