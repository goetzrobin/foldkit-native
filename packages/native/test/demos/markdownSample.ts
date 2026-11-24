/**
 * The replies the Streaming markdown demo plays back, and how a reply is cut
 * into tokens the way a language model sends them.
 *
 * `SAMPLE_REPLY` uses every element once. `longReply()` is about 3,000 words
 * for a stress test.
 */

export const SAMPLE_REPLY = `# Planning a long run

Here is a plan for **Saturday's long run**, with *one* change from last week and a ~~faster~~ steadier pace. Read the [training notes](https://foldkit.dev) for the reasons.

## Pace by section

| Section | Distance | Pace | Heart rate |
| --- | ---: | ---: | --- |
| Warm up | 2 km | 6:30 /km | under 140 |
| Steady | 14 km | 5:45 /km | 145 to 155 |
| Finish | 4 km | 5:20 /km | up to 165 |

## Before you go

1. Eat something small two hours before.
2. Fill **both** bottles, one with salts.
3. Check the weather and pick a layer.

Things to pack:

- Phone and a card
- Two gels, taken at 8 km and 15 km
- A light jacket if it is under 10 degrees

Last week's checklist:

- [x] Shoes with under 600 km on them
- [x] Route saved on the watch
- [ ] Rest day on Friday

> Run the first half slower than feels right. The second half is where the work is.

## Splitting the run in code

Use \`splitRun(distance, sections)\` to get the split for each section:

\`\`\`typescript
type Section = { name: string; share: number }

export const splitRun = (distance: number, sections: ReadonlyArray<Section>) =>
  sections.map(section => ({
    name: section.name,
    km: Math.round(distance * section.share * 10) / 10,
  }))

// 20 km: 2 warm up, 14 steady, 4 finish
console.log(splitRun(20, [
  { name: 'Warm up', share: 0.1 },
  { name: 'Steady', share: 0.7 },
  { name: 'Finish', share: 0.2 },
]))
\`\`\`

And the same in Swift, for the watch:

\`\`\`swift
struct Section { let name: String; let share: Double }

func splitRun(_ distance: Double, _ sections: [Section]) -> [(String, Double)] {
  sections.map { ($0.name, (distance * $0.share * 10).rounded() / 10) }
}
\`\`\`

---

![A road at sunrise](https://picsum.photos/seed/foldkit-run/800/400)

That is all. Tap the link above to open it, or long press any text to select and copy it.
`

const LONG_PARAGRAPHS = [
  'A long reply is where streaming shows its cost. Every new token makes the reply a little longer, and the screen has to show it without stutter. The native view parses the whole reply again on each change, on a background thread, and keeps every block that did not change.',
  'Foldkit sends **at most one** new text to the native view per frame. When tokens arrive faster than the screen draws, the ones in between are folded into the next frame. Nothing is lost: the newest text always wins.',
  'Half-written syntax is finished before it is sent. An open `**bold` is closed, a link without its address shows as plain words, and a code block that has not ended yet is drawn as far as it has got.',
  'Tables grow row by row. Code blocks grow line by line and are coloured once they are complete. New words fade in over a fifth of a second, unless the phone is set to reduce motion.',
]

const LONG_TABLE = `| Step | What happens | Where |
| --- | --- | --- |
| 1 | A token arrives | JavaScript |
| 2 | The view runs with the longer text | JavaScript |
| 3 | remend finishes open syntax, once a frame | JavaScript |
| 4 | md4c parses the reply | native, background |
| 5 | Changed blocks are drawn, new text fades in | native, main |`

const LONG_CODE = `\`\`\`typescript
// One update per frame, the newest text wins.
const onToken = (text: string) => {
  pending = text
  if (!isFrameAsked) {
    isFrameAsked = true
    requestAnimationFrame(() => {
      isFrameAsked = false
      send(remend(pending))
    })
  }
}
\`\`\``

const countWords = (text: string): number => text.split(/\s+/).filter(word => word !== '').length

let long: string | undefined

/** About 3,000 words: sections of headings, paragraphs, lists, a table and code. */
export const longReply = (): string => {
  if (long !== undefined) return long
  const parts: Array<string> = ['# A long reply, for a stress test']
  let section = 0
  while (countWords(parts.join('\n\n')) < 3000) {
    section++
    parts.push(`## Section ${section}`)
    for (const paragraph of LONG_PARAGRAPHS) parts.push(paragraph)
    parts.push(
      [
        `- Point ${section}.1: keep the screen still`,
        `- Point ${section}.2: send less, not more`,
        `- Point ${section}.3: let native code do the drawing`,
      ].join('\n'),
    )
    if (section % 2 === 1) parts.push(LONG_TABLE)
    else parts.push(LONG_CODE)
  }
  long = `${parts.join('\n\n')}\n`
  return long
}

/** Word count, for the demo's labels and the tests. */
export const wordCount = countWords

/**
 * Cuts a reply into pieces the size a language model sends: a word with the
 * space before it, and long words in pieces of up to six letters.
 */
export const tokensOf = (reply: string): ReadonlyArray<string> => reply.match(/\s*[^\s]{1,6}|\s+/g) ?? []
