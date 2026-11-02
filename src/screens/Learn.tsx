import { useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, HelpTip, Panel } from '../ui/Primitives';

type Topic = 'start' | 'mix' | 'master' | 'tools';

const TOPICS: { id: Topic; label: string; description: string }[] = [
  { id: 'start', label: 'Start here', description: 'A practical first session for beginners' },
  { id: 'mix', label: 'Mixing', description: 'Build clarity, balance and depth' },
  { id: 'master', label: 'Mastering', description: 'Finish, measure and deliver your mix' },
  { id: 'tools', label: 'Tools & references', description: 'Trusted external learning and metering resources' },
];

const LESSONS = [
  {
    id: 'gain',
    topic: 'mix' as Topic,
    title: 'Start with balance, not plugins',
    level: 'Beginner',
    time: '5 min',
    summary: 'A good mix starts with choosing what should lead, what should support it, and how loud each element feels.',
    steps: [
      'Listen to the whole song before changing anything. Write down three things you want to improve.',
      'Pull track faders down and build the balance from the most important element, often the lead vocal or main instrument.',
      'Bring in the kick, bass, drums and supporting parts one at a time.',
      'Keep enough headroom that the master bus is not clipping while you mix.',
      'Only add EQ or compression when you can describe the problem you are trying to solve.',
    ],
    tip: 'Use the mixer faders first. If the balance works without processing, you have a stronger starting point.',
    action: 'studio' as const,
  },
  {
    id: 'eq',
    topic: 'mix' as Topic,
    title: 'Use EQ to solve a specific problem',
    level: 'Beginner',
    time: '6 min',
    summary: 'Equalization changes the level of selected frequency ranges. It is most useful when guided by a listening problem rather than a preset curve.',
    steps: [
      'Find the sound that feels muddy, boomy, thin or harsh.',
      'Make a small, narrow change while listening in the full mix.',
      'Compare EQ on and off at matched loudness.',
      'Check whether the change helps the whole arrangement, not only the soloed track.',
      'Avoid cutting or boosting every track just because a frequency chart shows energy there.',
    ],
    tip: 'Frequency ranges overlap between instruments. Arrangement, note choice and level balance can solve masking more naturally than extreme EQ.',
    action: 'studio' as const,
  },
  {
    id: 'compression',
    topic: 'mix' as Topic,
    title: 'Understand compression before chasing settings',
    level: 'Beginner',
    time: '7 min',
    summary: 'A compressor reduces level when the signal crosses its threshold. Ratio, attack, release, knee and makeup gain shape how it behaves.',
    steps: [
      'Set the threshold so the compressor acts only when the signal gets louder than the level you choose.',
      'Use ratio to control how strongly peaks above the threshold are reduced.',
      'Attack affects how quickly compression begins; release affects how quickly it lets go.',
      'Watch gain reduction and listen for unwanted pumping, dull transients or unstable vocals.',
      'Level-match the bypass comparison so added loudness does not fool your judgement.',
    ],
    tip: 'There is no universal attack or release setting. The right response depends on tempo, source, performance and the effect you want.',
    action: 'studio' as const,
  },
  {
    id: 'space',
    topic: 'mix' as Topic,
    title: 'Create width without losing the centre',
    level: 'Intermediate',
    time: '5 min',
    summary: 'Stereo effects can make a mix feel wider, but wide does not automatically mean better or more compatible with mono playback.',
    steps: [
      'Keep important low-frequency and lead elements stable in the centre where the arrangement benefits from it.',
      'Use panning, room/reverb sends and stereo effects to create contrast between foreground and background.',
      'Check the correlation meter and listen in mono.',
      'If an element becomes thin or disappears in mono, reduce the width effect or revisit the processing that caused the cancellation.',
    ],
    tip: 'Treat stereo width as an arrangement decision. Check the result on headphones and speakers, and do not rely on a width number alone.',
    action: 'studio' as const,
  },
  {
    id: 'reference',
    topic: 'start' as Topic,
    title: 'Choose a useful reference track',
    level: 'Beginner',
    time: '4 min',
    summary: 'A reference works best when it has a similar musical role and arrangement to your song.',
    steps: [
      'Choose a professionally released track in a similar genre and production style.',
      'Compare similar sections, such as chorus to chorus, rather than a quiet verse to a loud drop.',
      'Turn the reference down or use loudness-matched comparison before judging tone.',
      'Decide which qualities you want to learn from: low end, vocal presence, dynamics, width or overall brightness.',
      'Use the generated chain as a starting point and trust your own arrangement and taste.',
    ],
    tip: 'You can combine references for different characteristics, but do not assume one reference is the correct answer for every part of your mix.',
    action: 'reference' as const,
  },
  {
    id: 'master',
    topic: 'master' as Topic,
    title: 'Master for the destination, not a magic number',
    level: 'Beginner',
    time: '6 min',
    summary: 'Loudness targets are delivery choices. Different platforms and broadcast standards use different workflows.',
    steps: [
      'Choose the actual destination before setting a target.',
      'Measure integrated loudness and true peak on the rendered master, not only on the live preview.',
      'Listen for distortion, pumping and lost transients as the limiter works harder.',
      'Compare versions at matched listening volume.',
      'Check the current delivery requirements from the platform or distributor before final export.',
    ],
    tip: 'Spotify currently describes -14 LUFS as its normalisation reference and gives true-peak guidance for delivery. That is platform guidance, not a universal mastering law. EBU R 128 is a broadcast programme-loudness recommendation at -23 LUFS.',
    action: 'mastering' as const,
  },
  {
    id: 'export',
    topic: 'master' as Topic,
    title: 'Verify the export you are actually sending',
    level: 'Beginner',
    time: '4 min',
    summary: 'The final file is the product. Re-open and measure the encoded result rather than assuming the render settings are enough.',
    steps: [
      'Use WAV or AIFF for a high-quality master delivery unless your distributor asks for another format.',
      'Choose bit depth and sample rate according to the delivery specification.',
      'When reducing bit depth to integer PCM, use appropriate dithering.',
      'Re-import or verify the rendered file and confirm duration, channel count, loudness and true peak.',
      'Keep a copy of the project and the original source files.',
    ],
    tip: 'A high sample rate does not repair a poor mix. Clean processing, correct delivery settings and verification matter more.',
    action: 'export' as const,
  },
];

const RESOURCES = [
  {
    category: 'Platform delivery',
    title: 'Spotify — Loudness normalization',
    description: 'Explains Spotify playback normalization, its -14 LUFS reference and true-peak suggestions for lossy encoding.',
    url: 'https://support.spotify.com/us/artists/article/loudness-normalization/',
    type: 'Official platform guidance',
  },
  {
    category: 'Broadcast standards',
    title: 'EBU R 128 — Loudness normalization',
    description: 'The EBU recommendation for programme loudness, Loudness Range and maximum true peak in broadcast workflows.',
    url: 'https://tech.ebu.ch/publications/r128',
    type: 'Official technical recommendation',
  },
  {
    category: 'Independent metering',
    title: 'Youlean Loudness Meter',
    description: 'A free loudness-meter option for checking integrated loudness, loudness range and true peak outside Sonora.',
    url: 'https://youlean.co/youlean-loudness-meter/',
    type: 'External tool · free version available',
  },
  {
    category: 'Mixing education',
    title: 'FabFilter Learn — Mixing',
    description: 'Accessible lessons on EQ, compression, reverb, automation, sound stage and stereo mixing.',
    url: 'https://www.fabfilter.com/learn/mixing',
    type: 'Educational articles and videos',
  },
  {
    category: 'EQ and dynamics',
    title: 'FabFilter Learn — Equalization',
    description: 'Understand frequency ranges, tonal balance, filters and phase-related EQ choices.',
    url: 'https://www.fabfilter.com/learn/equalization',
    type: 'Educational guide',
  },
  {
    category: 'EQ and dynamics',
    title: 'FabFilter Learn — Compression',
    description: 'Learn threshold, ratio, attack, release, bus compression, parallel compression and sidechain techniques.',
    url: 'https://www.fabfilter.com/learn/compression',
    type: 'Educational guide',
  },
  {
    category: 'Delivery and codec checks',
    title: 'Apple Digital Masters',
    description: 'Apple’s mastering information and tools for auditioning AAC encoding and checking delivery quality.',
    url: 'https://www.apple.com/apple-music/apple-digital-masters/',
    type: 'Official Apple resource',
  },
  {
    category: 'Mix workflow',
    title: 'iZotope — How to mix a track from start to finish',
    description: 'A structured workflow covering reference listening, gain staging, kick/bass relationship and vocal mixing.',
    url: 'https://www.izotope.com/community/blog/how-to-mix-a-track-from-start-to-finish',
    type: 'Educational article',
  },
];

export default function Learn() {
  const [topic, setTopic] = useState<Topic>('start');
  const [expanded, setExpanded] = useState<string | null>('reference');
  const { mode } = useApp();
  const lessons = LESSONS.filter((lesson) => topic === 'tools' ? false : lesson.topic === topic);
  const openWorkspace = (screen: 'studio' | 'reference' | 'mastering' | 'export') => {
    const state = useApp.getState();
    if (!state.project) {
      state.setToast('Create or open a project first, then return here to continue.');
      state.setScreen('projects');
      return;
    }
    state.setScreen(screen);
  };

  return (
    <div className="mx-auto max-w-[1450px] space-y-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-[#172027] via-[#10151b] to-[#0b0e12] p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <Badge tone="accent">Sonora Academy</Badge>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Learn the sound. Shape your sound.</h1>
            <p className="mt-2 text-sm leading-6 text-ink-300">
              Practical, beginner-friendly mixing and mastering lessons, plus references from established audio educators and delivery organisations.
              Use the tips as guidance—not as rules that override your ears.
            </p>
          </div>
          <HelpTip title="How to use these lessons" steps={['Choose one topic.', 'Open a short lesson and follow the steps in Sonora.', 'Make one change at a time.', 'Compare with bypass at a similar loudness.', 'Keep only the change that genuinely improves your mix.']}>
            These lessons are written as practical starting points. The linked resources provide deeper explanations and current platform or standards guidance.
          </HelpTip>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {TOPICS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTopic(item.id)}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${topic === item.id ? 'border-accent/35 bg-accent/10 text-accent' : 'border-ink-700 bg-ink-900/70 text-ink-300 hover:border-ink-500'}`}
          >
            <span className="block text-xs font-medium">{item.label}</span>
            <span className="mt-0.5 block text-2xs opacity-65">{item.description}</span>
          </button>
        ))}
      </div>

      {topic === 'tools' ? (
        <section className="space-y-3">
          <div>
            <div className="section-label">Curated library</div>
            <h2 className="mt-1 text-lg font-semibold text-ink-100">Trusted tools and learning resources</h2>
            <p className="mt-1 text-xs text-ink-500">External resources open on their own websites. Product and platform recommendations can change, so check current details before relying on them.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {RESOURCES.map((resource) => (
              <article key={resource.title} className="flex flex-col rounded-xl border border-ink-700 bg-ink-900/70 p-4 transition-colors hover:border-ink-500">
                <div className="flex items-center justify-between gap-2">
                  <Badge>{resource.category}</Badge>
                  <span className="text-[9px] text-ink-600">{resource.type}</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink-100">{resource.title}</h3>
                <p className="mt-2 flex-1 text-xs leading-5 text-ink-400">{resource.description}</p>
                <a href={resource.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-accent hover:underline">
                  Open resource <span aria-hidden="true">↗</span>
                </a>
              </article>
            ))}
          </div>
          <Panel title="A note about standards">
            <p className="text-xs leading-5 text-ink-400">
              Broadcasting and music streaming are not the same delivery context. EBU R 128 specifies a -23 LUFS programme-loudness recommendation for broadcast; Spotify documents its own playback normalisation and mastering guidance. Sonora therefore treats loudness targets as selectable delivery choices, not a universal preset.
            </p>
          </Panel>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="section-label">Guided lessons</div>
                <h2 className="mt-1 text-lg font-semibold text-ink-100">{TOPICS.find((item) => item.id === topic)?.label}</h2>
              </div>
              <Badge>{lessons.length} lessons</Badge>
            </div>
            {lessons.map((lesson) => (
              <article key={lesson.id} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900/70">
                <button
                  type="button"
                  onClick={() => setExpanded((current) => current === lesson.id ? null : lesson.id)}
                  aria-expanded={expanded === lesson.id}
                  className="flex w-full items-start justify-between gap-3 p-4 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink-100">{lesson.title}</span>
                      <Badge tone={lesson.level === 'Beginner' ? 'accent' : 'info'}>{lesson.level}</Badge>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-ink-400">{lesson.summary}</span>
                    <span className="mt-2 block font-mono text-2xs text-ink-600">{lesson.time} read</span>
                  </span>
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ink-700 bg-ink-850 text-ink-300">{expanded === lesson.id ? '−' : '+'}</span>
                </button>
                {expanded === lesson.id && (
                  <div className="border-t border-ink-700 bg-black/10 p-4">
                    <ol className="space-y-2.5">
                      {lesson.steps.map((step, index) => (
                        <li key={step} className="flex gap-3 text-xs leading-5 text-ink-300">
                          <span className="mt-0.5 font-mono text-2xs text-accent">{String(index + 1).padStart(2, '0')}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-4 rounded-lg border border-accent/20 bg-accent/5 p-3">
                      <div className="text-2xs font-semibold uppercase tracking-wider text-accent">Studio tip</div>
                      <p className="mt-1 text-xs leading-5 text-ink-300">{lesson.tip}</p>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" variant="primary" onClick={() => openWorkspace(lesson.action)}>Try this in Sonora ↗</Button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>

          <aside className="space-y-3">
            <Panel title="The beginner loop">
              <ol className="space-y-3">
                {[
                  ['Listen', 'Play the whole song without touching a control.'],
                  ['Decide', 'Choose one problem you can describe in plain language.'],
                  ['Change', 'Make one small adjustment.'],
                  ['Compare', 'Bypass it and match listening volume.'],
                  ['Keep or undo', 'Keep it only if the mix improves.'],
                ].map(([title, description], index) => (
                  <li key={title} className="flex gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-800 font-mono text-2xs text-accent">{index + 1}</span>
                    <span><span className="block text-xs text-ink-100">{title}</span><span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">{description}</span></span>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel title="Quick tools">
              <div className="space-y-2">
                <Button onClick={() => openWorkspace('studio')}>Open Mixing Studio</Button>
                <Button onClick={() => openWorkspace('reference')}>Open Reference Match</Button>
                <Button onClick={() => openWorkspace('mastering')}>Open Mastering</Button>
              </div>
            </Panel>
            <Panel title="Remember">
              <p className="text-xs leading-5 text-ink-400">
                Presets and measurements are starting points. A balanced, expressive mix is more important than copying a curve, reaching a loudness number or using every processor available.
              </p>
            </Panel>
          </aside>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-3">
        <span className="text-2xs text-ink-600">Educational content is guidance, not a substitute for checking your own audio and delivery requirements.</span>
        <Badge tone="info">{mode === 'beginner' ? 'Beginner-friendly explanations' : 'Engineer mode · all controls available'}</Badge>
      </div>
    </div>
  );
}
