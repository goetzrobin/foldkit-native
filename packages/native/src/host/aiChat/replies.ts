/**
 * What the pretend model says. There is no real model: a question is
 * matched against a few keywords and one of the replies below is chosen.
 *
 * Each reply is Markdown and, between them, they use everything a chat
 * screen has to draw: headings, lists, numbered lists, a code block, a
 * table, a link, bold and italic text. Some replies first "think" (they
 * stream reasoning), and some call a pretend tool and wait for its answer.
 *
 * All the text here was written for this demo.
 */

/** A tool call the reply makes before answering. */
export type ScriptedTool = Readonly<{
  name: 'search_notes' | 'get_weather'
  input: Readonly<Record<string, string>>
  output: string
}>

/** One reply, in the order it is streamed: reasoning, tool, answer. */
export type Script = Readonly<{
  /** Which reply this is, for tests and the demo's log. */
  kind: 'running' | 'travel' | 'weather' | 'notes' | 'code' | 'general'
  reasoning?: string
  tool?: ScriptedTool
  answer: string
}>

const RUNNING = `## Starting to run

The trick is to start *slower and shorter* than feels useful. Most new runners stop because they did too much in week one, not too little.

### The first four weeks

1. Run **three times a week**, never two days in a row.
2. Mix running and walking: 1 minute of each, eight times.
3. Each week, run a little longer and walk a little less.
4. Keep the pace easy enough to talk in full sentences.

| Week | Run | Walk | Repeats |
| --- | --- | --- | --- |
| 1 | 1 min | 1 min | 8 |
| 2 | 2 min | 1 min | 7 |
| 3 | 3 min | 1 min | 6 |
| 4 | 5 min | 1 min | 5 |

### Small things that help

- Shoes that fit matter more than shoes that are expensive.
- Run at the same time of day, so it becomes a habit and not a decision.
- A sore muscle is fine. A sharp pain in a joint means *stop for today*.

If you like numbers, here is the pace math:

\`\`\`ts
// minutes per kilometre from a distance and a time
const pace = (km: number, minutes: number): string => {
  const perKm = minutes / km
  const whole = Math.floor(perKm)
  const seconds = Math.round((perKm - whole) * 60)
  return \`\${whole}:\${String(seconds).padStart(2, '0')} per km\`
}

pace(5, 32) // "6:24 per km"
\`\`\`

For a longer plan, the [NHS Couch to 5K](https://www.nhs.uk/live-well/exercise/running-and-aerobic-exercises/get-running-with-couch-to-5k/) programme is free and well tested.`

const TRAVEL_REASONING = `The person is choosing between the train and the car for a trip to the coast. I should compare the things that usually decide it: total time door to door, cost for one person versus a group, what they can do on the way, and parking at the other end. I do not know the distance, so I will assume a two to three hour trip and say so. Trains win for one or two people who want to read or rest. Cars win for groups, heavy bags, or places far from a station. I will put the comparison in a table and end with a simple rule.`

const TRAVEL = `## Train or car to the coast

*I assumed a trip of two to three hours. Tell me the route for a sharper answer.*

| | Train | Car |
| --- | --- | --- |
| Door to door | About the same, if the station is close | Faster for places far from a station |
| Cost for one | Usually **cheaper** | Fuel, tolls and parking add up |
| Cost for four | Four tickets | Usually **cheaper** |
| On the way | Read, sleep, work | Drive |
| At the coast | Walk or local bus | Free to explore, but find parking |

### A simple rule

- **One or two people**, light bags, a town by the station: take the *train*.
- **Three or more**, a dog, or a beach far from a station: take the *car*.
- Going on a sunny weekend? Car parks at the coast fill by mid morning, so the train may save the day.

If you go by car, leave before 8. If by train, book a few days ahead: prices often rise in the last 48 hours.`

const weatherFor = (city: string) => {
  const reasoning = `They want the weather in ${city}. I cannot know it myself, so I should call the weather tool for tomorrow and then turn its answer into something useful: what to wear and whether to bring an umbrella.`
  const output = JSON.stringify({
    city,
    day: 'tomorrow',
    summary: 'Sunny morning, clouds after lunch, a shower possible in the evening',
    highC: 21,
    lowC: 13,
    rainChance: { morning: 5, afternoon: 25, evening: 55 },
    windKmh: 18,
  })
  const answer = `## Tomorrow in ${city}

A **sunny morning**, clouds after lunch, and a *chance of a shower* in the evening.

| Time | Sky | Temperature | Rain |
| --- | --- | --- | --- |
| Morning | Sunny | 13 to 17 °C | 5% |
| Afternoon | Clouds | 19 to 21 °C | 25% |
| Evening | Showers likely | 16 °C | 55% |

### What to bring

- A light jacket for the morning and the evening.
- A small umbrella if you will be out after 6 pm.
- Sunglasses: the morning will be bright.

Wind about 18 km/h from the north west. *This is pretend weather from the demo's tool, not a forecast.* For a real one, try [Open-Meteo](https://open-meteo.com/).`
  return { reasoning, output, answer }
}

const notesFor = (query: string) => {
  const output = JSON.stringify({
    query,
    results: [
      { title: 'Kitchen move', date: '2026-11-02', excerpt: 'Movers booked for the 14th. Ask about the fridge.' },
      { title: 'Ideas for the garden', date: '2026-10-18', excerpt: 'Raised beds by the fence. Tomatoes, beans, basil.' },
      { title: 'Book club', date: '2026-09-30', excerpt: 'Next: The Left Hand of Darkness. Host: Priya.' },
    ],
  })
  const answer = `## What your notes say

I found **three notes** that look related to *${query}*:

1. **Kitchen move** (2 November): the movers are booked for the 14th. You wanted to *ask about the fridge*.
2. **Ideas for the garden** (18 October): raised beds by the fence, with tomatoes, beans and basil.
3. **Book club** (30 September): the next book is *The Left Hand of Darkness*, and Priya is hosting.

### Still open

- [ ] Call the movers about the fridge
- [ ] Buy wood for the raised beds
- [x] Pick the next book

| Note | Last changed | Open items |
| --- | --- | --- |
| Kitchen move | 2 Nov | 1 |
| Ideas for the garden | 18 Oct | 1 |
| Book club | 30 Sep | 0 |

Want me to turn the open items into a list for this week?`
  return { output, answer }
}

const CODE = `## A debounce function

A debounce waits until calls *stop* for a moment, then runs once. It is what a search box uses so that it does not search on every key.

\`\`\`ts
export const debounce = <Args extends ReadonlyArray<unknown>>(
  run: (...args: Args) => void,
  waitMs: number,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      run(...args)
    }, waitMs)
  }
}

const search = debounce((text: string) => console.log('search', text), 300)
search('c')
search('ca')
search('cat') // only this one runs, 300 ms later
\`\`\`

### How it works

- Each call **cancels** the timer of the call before it.
- Only the last call in a quick burst survives long enough to run.
- \`waitMs\` is how quiet things must be before it runs.

| Want | Use |
| --- | --- |
| Run after typing stops | Debounce |
| Run at most every 100 ms while scrolling | Throttle |

See [MDN on setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout) for the timer itself.`

const generalFor = (question: string) => {
  const short = question.length > 60 ? `${question.slice(0, 57)}...` : question
  return `## About "${short}"

I am a **pretend assistant** inside a demo, so I only know a few topics well. Here is what I can show you:

- *Running*: ask how to start running.
- *Travel*: ask whether to take the train or drive, and I will think it through first.
- *Weather*: ask about the weather in a city, and I will call a tool.
- *Notes*: ask what your notes say, and I will search them.
- *Code*: ask for a debounce function.

### Why the answers are scripted

A real model would answer anything. This one picks a reply by keywords and sends it a few letters at a time, at a speed you can set, so the app can be built and tested without a network or a bill.

| Setting | What it changes |
| --- | --- |
| Speed | How fast the words arrive |
| Chaos | Failures, dropped connections, a slow start |

The server and the wire are built with [Effect](https://effect.website/), like a real one would be.`
}

/** Whether a word starts somewhere in the text: "rain" is in "rainy", not in "train". */
const has = (text: string, words: ReadonlyArray<string>): boolean =>
  words.some(word => {
    const at = text.indexOf(word.trim())
    for (let index = at; index >= 0; index = text.indexOf(word.trim(), index + 1)) {
      if (index === 0 || !/[a-z0-9]/.test(text[index - 1] as string)) return true
    }
    return false
  })

const cityIn = (question: string): string => {
  const match = /\b(?:in|for|at)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/.exec(question)
  return match?.[1] ?? 'your city'
}

const topicOf = (question: string): string => {
  const match = /\babout\s+([^?.!]+)/i.exec(question)
  return (match?.[1] ?? 'this week').trim()
}

/** The reply to a question. The same question always gets the same reply. */
export const pickReply = (question: string): Script => {
  const text = question.toLowerCase()
  const wantsThought = has(text, ['should', 'think', 'why', 'compare', 'vs', 'versus', 'which is better'])

  if (has(text, ['weather', 'rain', 'umbrella', 'forecast', 'temperature'])) {
    const city = cityIn(question)
    const weather = weatherFor(city)
    return {
      kind: 'weather',
      ...(wantsThought ? { reasoning: weather.reasoning } : {}),
      tool: { name: 'get_weather', input: { city, day: 'tomorrow' }, output: weather.output },
      answer: weather.answer,
    }
  }
  if (has(text, ['note', 'remember', 'what did i write'])) {
    const query = topicOf(question)
    const notes = notesFor(query)
    return {
      kind: 'notes',
      tool: { name: 'search_notes', input: { query }, output: notes.output },
      answer: notes.answer,
    }
  }
  if (has(text, ['train', 'drive', 'car', 'travel', 'trip'])) {
    return { kind: 'travel', reasoning: TRAVEL_REASONING, answer: TRAVEL }
  }
  if (has(text, ['code', 'function', 'typescript', 'debounce', 'javascript'])) {
    return { kind: 'code', answer: CODE }
  }
  if (has(text, ['run', 'jog', 'marathon', '5k'])) {
    return {
      kind: 'running',
      ...(wantsThought
        ? { reasoning: 'They want to start running. The most common mistake is doing too much too soon, so I will give a gentle run-walk plan, a table for four weeks, and a few habits.' }
        : {}),
      answer: RUNNING,
    }
  }
  return { kind: 'general', answer: generalFor(question.trim()) }
}

/**
 * Cuts text into token-sized pieces, about as a model's tokenizer would:
 * one to four letters, with the space before a word kept on its first
 * piece. Joining the pieces gives back the text exactly.
 */
export const tokenize = (text: string): ReadonlyArray<string> => text.match(/\s*\S{1,4}|\s+$/g) ?? []

/** A title from the first words of the first message, as chat apps do. */
export const titleFrom = (text: string): string => {
  const words = text.trim().replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ')
  const clean = words.replace(/[?.!,;:]+$/, '')
  return clean.length === 0 ? 'New chat' : clean.length > 40 ? `${clean.slice(0, 39)}…` : clean
}
