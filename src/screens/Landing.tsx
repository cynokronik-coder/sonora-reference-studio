import type { ReactNode } from 'react';

type LandingProps = {
  onEnterStudio: () => void;
  onOpenPricing: () => void;
};

const BAR_HEIGHTS = [18, 28, 21, 35, 30, 43, 27, 50, 38, 57, 44, 65, 50, 73, 54, 82, 62, 74, 48, 68, 42, 60, 34, 52, 29, 45, 23, 36, 19, 30, 14, 22];

const FEATURES = [
  {
    number: '01',
    symbol: '◎',
    title: 'Understand the difference',
    description: 'Go beyond “it sounds a bit dull”. Sonora measures loudness, true peak, frequency balance, dynamics, stereo behaviour and rhythm so you can make decisions with context.',
    tags: ['LUFS & true peak', '31-band spectrum', 'Stereo & dynamics'],
  },
  {
    number: '02',
    symbol: '⌁',
    title: 'Match a reference — your way',
    description: 'Compare your mix with the records you admire. Explore tonal, dynamic, stereo and punch differences, then build a suggested chain you can inspect and edit.',
    tags: ['Multiple references', 'Per-category control', 'Editable suggestions'],
  },
  {
    number: '03',
    symbol: '▤',
    title: 'Shape the whole mix',
    description: 'Arrange multitrack sessions, move and trim clips, work with tracks and buses, and shape each part with a real-time processing chain.',
    tags: ['Multitrack timeline', 'Tracks & buses', 'Clip gain & fades'],
  },
  {
    number: '04',
    symbol: '◒',
    title: 'Use real processing tools',
    description: 'Build your sound with an implemented DSP engine: EQ, compression, multiband dynamics, de-essing, saturation, stereo tools, reverb, delay and more.',
    tags: ['16 processor types', 'Reorder & bypass', 'Detailed parameters'],
  },
  {
    number: '05',
    symbol: '↗',
    title: 'Render, compare, verify',
    description: 'Render offline through the same processing graph used for playback. Check the result again, compare versions, and make informed final adjustments.',
    tags: ['A/B comparisons', 'Offline rendering', 'Post-render analysis'],
  },
  {
    number: '06',
    symbol: '✳',
    title: 'Get a second opinion from AI',
    description: 'The optional connected assistant can inspect project context and measured results, request analysis, and prepare processor changes for your approval. Nothing is applied automatically.',
    tags: ['Natural-language guidance', 'Preview before applying', 'You stay in control'],
  },
];

const STEPS = [
  ['01', 'Bring your session in', 'Import a stereo mix, individual stems, or open an existing project. Your original audio is kept separate from your edits.'],
  ['02', 'Add a reference', 'Choose one or more tracks whose balance, punch or stereo character gives you a useful direction.'],
  ['03', 'Measure and shape', 'Review the differences, generate an editable starting point, then refine the mix and master using the tools you choose.'],
  ['04', 'Listen, verify, export', 'Compare at a fair listening level, render the result, review the measurements and export your file.'],
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] uppercase tracking-[.22em] text-accent/80">{children}</p>;
}

function ArrowMark() {
  return <span aria-hidden="true" className="ml-2 transition-transform group-hover:translate-x-1">↗</span>;
}

function StudioPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[610px]">
      <div className="absolute -inset-8 rounded-full bg-accent/[.07] blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e12] shadow-[0_30px_100px_rgba(0,0,0,.55)]">
        <div className="flex items-center justify-between border-b border-white/[.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 font-mono text-sm text-accent">≋</div>
            <div>
              <div className="text-[11px] font-semibold tracking-[.16em] text-white">SONORA</div>
              <div className="font-mono text-[8px] uppercase tracking-[.17em] text-ink-500">Reference Studio</div>
            </div>
          </div>
          <span className="rounded-full border border-accent/20 bg-accent/[.07] px-2.5 py-1 font-mono text-[8px] tracking-[.12em] text-accent">SESSION OVERVIEW</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-xl border border-white/[.08] bg-black/25 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[.15em] text-ink-400">Reference comparison</span>
              <span className="text-[9px] text-ink-600">Illustrative view</span>
            </div>
            <div className="relative mt-4 h-[150px] overflow-hidden rounded-lg border border-white/[.06] bg-[#090b0e] px-3 pb-3 pt-4">
              <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)', backgroundSize: '100% 25%, 12.5% 100%' }} />
              <div className="absolute inset-x-3 top-2 flex justify-between font-mono text-[8px] text-ink-600"><span>LOW</span><span>MID</span><span>HIGH</span></div>
              <div className="relative flex h-full items-end gap-[3px] pt-3">
                {BAR_HEIGHTS.map((height, i) => (
                  <div key={i} className="flex h-full min-w-0 flex-1 items-end">
                    <span className="w-full rounded-t-[2px] bg-gradient-to-t from-accent/20 to-accent/90" style={{ height: String(height) + '%' }} />
                  </div>
                ))}
              </div>
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 320 150" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 103 C28 93 35 79 58 83 S91 93 112 72 S145 42 168 58 S201 74 224 49 S260 45 282 31 S305 28 320 22" fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="5 4" opacity=".9" />
              </svg>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[9px] text-ink-400">
              <span className="flex items-center gap-1.5"><i className="h-1.5 w-4 rounded-full bg-accent" /> Your mix</span>
              <span className="flex items-center gap-1.5"><i className="h-[2px] w-4 border-t-2 border-dashed border-violet-400" /> Reference profile</span>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-white/[.08] bg-black/25 p-3">
              <div className="font-mono text-[9px] uppercase tracking-[.15em] text-ink-400">Analysis snapshot</div>
              <div className="mt-3 space-y-2.5">
                {[
                  ['LOUDNESS', 'Integrated & short-term'],
                  ['PEAKS', 'Sample & true peak'],
                  ['DYNAMICS', 'Range & crest factor'],
                  ['STEREO', 'Width & compatibility'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-2 border-b border-white/[.05] pb-2 last:border-0 last:pb-0">
                    <span className="font-mono text-[8px] text-ink-500">{label}</span>
                    <span className="text-right text-[9px] text-ink-200">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-accent/20 bg-accent/[.055] p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">Suggested chain</span>
                <span className="text-[8px] text-accent/65">EDITABLE</span>
              </div>
              <div className="mt-3 space-y-1.5">
                {['Parametric EQ', 'Bus Compressor', 'Stereo Imaging', 'True-Peak Limiter'].map((name, i) => (
                  <div key={name} className="flex items-center gap-2 rounded-md border border-white/[.07] bg-black/20 px-2 py-1.5">
                    <span className="font-mono text-[8px] text-ink-600">0{i + 1}</span>
                    <span className="flex-1 text-[9px] text-ink-200">{name}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent/80" />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[8px] leading-relaxed text-ink-500">A visual example of the workflow — not a reading from a live session.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[.08] bg-white/[.02] px-4 py-3">
          <span className="font-mono text-[8px] uppercase tracking-[.15em] text-ink-500">Measure · Compare · Refine · Render</span>
          <span className="text-[9px] text-ink-400">Your decisions stay editable.</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing({ onEnterStudio, onOpenPricing }: LandingProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-[#080a0d] text-ink-100">
      <div className="pointer-events-none fixed inset-0 opacity-[.18]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)', backgroundSize: '72px 72px' }} />
      <header className="relative z-10 border-b border-white/[.07] bg-[#090c10]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#top" className="flex items-center gap-3" aria-label="Sonora home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/[.08] font-mono text-xl text-accent shadow-[0_0_28px_rgba(200,241,105,.08)]">≋</span>
            <span>
              <span className="block text-sm font-semibold tracking-[.18em] text-white">SONORA</span>
              <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-[.22em] text-ink-500">Reference Studio</span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 md:flex">
            <a href="#capabilities" className="text-xs text-ink-400 transition hover:text-white">Capabilities</a>
            <a href="#workflow" className="text-xs text-ink-400 transition hover:text-white">How it works</a>
            <a href="#difference" className="text-xs text-ink-400 transition hover:text-white">Why Sonora</a>
            <a href="#faq" className="text-xs text-ink-400 transition hover:text-white">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onOpenPricing} className="rounded-lg border border-white/[.12] px-4 py-2.5 text-[11px] font-medium text-ink-300 transition hover:border-accent/30 hover:text-white">Pricing</button>
            <button type="button" onClick={onEnterStudio} className="group rounded-lg border border-accent/40 bg-accent px-4 py-2.5 text-[11px] font-semibold text-[#10150a] shadow-[0_0_28px_rgba(200,241,105,.12)] transition hover:-translate-y-0.5 hover:bg-[#d5fa7a]">
              Open the studio <ArrowMark />
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="relative z-[1]">
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[.92fr_1.08fr] lg:gap-10 lg:pb-28 lg:pt-24">
          <div className="max-w-xl">
            <SectionLabel>Mixing · Reference matching · Mastering</SectionLabel>
            <h1 className="mt-6 text-[clamp(2.7rem,6vw,5.3rem)] font-semibold leading-[.98] tracking-[-.065em] text-white">
              Get closer to the sound you <span className="text-accent">hear in your head.</span>
            </h1>
            <p className="mt-7 max-w-lg text-sm leading-7 text-ink-300 sm:text-base sm:leading-8">
              Sonora brings mixing, measured reference matching, detailed audio analysis and mastering into one focused workspace. Build a sound you understand — and keep control of every move.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onEnterStudio} className="group rounded-lg bg-accent px-5 py-3 text-xs font-semibold text-[#10150a] transition hover:-translate-y-0.5 hover:bg-[#d5fa7a]">
                Explore Sonora <ArrowMark />
              </button>
              <a href="#workflow" className="rounded-lg border border-white/10 px-5 py-3 text-xs font-medium text-ink-200 transition hover:border-white/25 hover:bg-white/[.04]">
                See how it works <span aria-hidden="true" className="ml-1">↓</span>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[.08] pt-5 text-[10px] text-ink-500">
              <span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-accent" /> Local-first workflow</span>
              <span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-accent" /> Editable processing</span>
              <span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-accent" /> Beginner and engineer modes</span>
            </div>
          </div>
          <StudioPreview />
        </section>

        <section className="border-y border-white/[.07] bg-white/[.018]">
          <div className="mx-auto grid max-w-7xl gap-5 px-5 py-7 sm:grid-cols-3 sm:px-8">
            {[
              ['ONE WORKSPACE', 'Mix, compare, analyse and master'],
              ['REAL DSP ENGINE', 'Every processor changes the audio'],
              ['YOU STAY IN CONTROL', 'Suggestions are editable, not compulsory'],
            ].map(([eyebrow, detail]) => (
              <div key={eyebrow} className="flex items-start gap-3 sm:justify-center">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_rgba(200,241,105,.8)]" />
                <div><p className="font-mono text-[9px] tracking-[.16em] text-accent/75">{eyebrow}</p><p className="mt-1 text-xs text-ink-300">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section id="difference" className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:py-28">
          <div className="max-w-lg">
            <SectionLabel>Not just a one-click finish</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-.04em] text-white sm:text-4xl">A result matters. <span className="text-ink-500">Knowing how you got there matters too.</span></h2>
            <p className="mt-5 text-sm leading-7 text-ink-400">
              Quick mastering services can be useful when you simply need a fast starting point. Sonora is built for the next step: understanding what your mix needs, deciding what to change, and keeping those decisions in your hands.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/[.08] bg-white/[.025] p-5">
              <p className="font-mono text-[9px] uppercase tracking-[.17em] text-ink-500">The Sonora approach</p>
              <h3 className="mt-3 text-lg font-semibold text-white">See the process. Shape the result.</h3>
              <ul className="mt-5 space-y-3 text-xs leading-6 text-ink-300">
                <li className="flex gap-2"><span className="text-accent">✓</span><span>Measured analysis instead of vague “good / bad” scores.</span></li>
                <li className="flex gap-2"><span className="text-accent">✓</span><span>Reference-informed suggestions with editable parameters.</span></li>
                <li className="flex gap-2"><span className="text-accent">✓</span><span>A real mix and master chain you can inspect, reorder or bypass.</span></li>
                <li className="flex gap-2"><span className="text-accent">✓</span><span>Render and measure again before you call it finished.</span></li>
              </ul>
            </div>
            <div className="rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/[.08] to-transparent p-5">
              <p className="font-mono text-[9px] uppercase tracking-[.17em] text-accent/80">Built for creative control</p>
              <h3 className="mt-3 text-lg font-semibold text-white">Guidance when you need it. Detail when you want it.</h3>
              <p className="mt-4 text-xs leading-6 text-ink-300">Start in Beginner mode and follow the guided workflow. Switch to Engineer mode when you want full processor parameters, routing and deeper control.</p>
              <div className="mt-6 flex items-center gap-2">
                <span className="rounded-md border border-white/10 bg-black/20 px-3 py-2 font-mono text-[9px] text-ink-300">BEGINNER</span>
                <span className="text-accent">↔</span>
                <span className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 font-mono text-[9px] text-accent">ENGINEER</span>
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="border-y border-white/[.07] bg-[#0a0d11]">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="max-w-2xl">
              <SectionLabel>What you can do with Sonora</SectionLabel>
              <h2 className="mt-5 text-3xl font-semibold tracking-[-.045em] text-white sm:text-4xl">A complete toolkit for shaping your sound.</h2>
              <p className="mt-4 text-sm leading-7 text-ink-400">The point is not to hide the craft behind a button. It is to make the important information and tools easier to reach.</p>
            </div>
            <div className="mt-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {FEATURES.map((feature) => (
                <article key={feature.number} className="group rounded-2xl border border-white/[.08] bg-white/[.025] p-5 transition duration-300 hover:-translate-y-1 hover:border-accent/25 hover:bg-white/[.04]">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/[.07] text-lg text-accent">{feature.symbol}</span>
                    <span className="font-mono text-[10px] text-ink-600">{feature.number}</span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-white">{feature.title}</h3>
                  <p className="mt-3 min-h-[88px] text-xs leading-6 text-ink-400">{feature.description}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {feature.tags.map((tag) => <span key={tag} className="rounded-full border border-white/[.08] bg-black/20 px-2.5 py-1 font-mono text-[8px] text-ink-400">{tag}</span>)}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr]">
            <div className="max-w-md">
              <SectionLabel>A clear path from mix to master</SectionLabel>
              <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-.04em] text-white sm:text-4xl">Four steps. No mystery chain.</h2>
              <p className="mt-5 text-sm leading-7 text-ink-400">Use Sonora as a guided workflow or dive directly into the tools. You choose how much help you want along the way.</p>
              <button type="button" onClick={onEnterStudio} className="group mt-7 rounded-lg bg-accent px-5 py-3 text-xs font-semibold text-[#10150a] transition hover:-translate-y-0.5 hover:bg-[#d5fa7a]">Start with your own track <ArrowMark /></button>
            </div>
            <div className="space-y-3">
              {STEPS.map(([number, title, description]) => (
                <div key={number} className="grid gap-3 rounded-xl border border-white/[.08] bg-white/[.025] p-4 sm:grid-cols-[52px_1fr] sm:gap-5 sm:p-5">
                  <span className="font-mono text-sm text-accent">{number}</span>
                  <div><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-xs leading-6 text-ink-400">{description}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-white/[.07] bg-white/[.018]">
          <div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 sm:grid-cols-3 sm:px-8 lg:py-20">
            {[
              ['For artists', 'Finish your own releases with a clearer picture of what is working and what still needs attention.'],
              ['For producers', 'Move between arrangement, mix decisions and final processing without losing sight of the reference.'],
              ['For engineers', 'Use detailed measurements and configurable DSP as a focused environment for technical decisions.'],
            ].map(([title, detail]) => (
              <div key={title} className="border-l border-accent/35 pl-4">
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                <p className="mt-2 text-xs leading-6 text-ink-400">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-5xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="max-w-xl">
            <SectionLabel>Good to know</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">A few questions, answered.</h2>
          </div>
          <div className="mt-8 divide-y divide-white/[.08] border-y border-white/[.08]">
            {[
              ['Do I need to be an audio engineer?', 'No. Beginner mode keeps the workflow focused and gives you a guided starting point. Engineer mode is there when you want deeper routing and processor controls.'],
              ['Does Sonora automatically copy my reference track?', 'No. Reference matching is perceptual, not duplication. It compares measurable characteristics and suggests changes; it cannot copy a performance, arrangement, instrument or exact mix identity.'],
              ['Does the AI assistant listen to or upload my audio?', 'The optional connected assistant receives project structure and computed measurements, not raw PCM audio. Audio analysis itself runs locally in your browser in this build.'],
              ['Can I edit the processing suggestions?', 'Yes. Suggested processor changes are previews. You can review, accept or reject them, then continue editing the chain and undo approved changes.'],
              ['What can I export?', 'The current export workflow supports WAV, AIFF and MP3, with selectable bit depth and sample rate options.'],
              ['Is Sonora a replacement for every DAW?', 'Sonora is a focused audio production, reference-matching and mastering workspace. It is not presented as a replacement for every recording or arrangement workflow in a full DAW.'],
            ].map(([question, answer]) => (
              <details key={question} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-ink-200 marker:content-none hover:text-white">
                  {question}
                  <span className="text-xl font-light text-accent transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-3xl pt-3 text-xs leading-6 text-ink-400">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-8 lg:pb-28">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl border border-accent/20 bg-[#111711] px-6 py-12 text-center sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(200,241,105,.13),transparent_60%)]" />
            <div className="relative mx-auto max-w-2xl">
              <SectionLabel>Your next mix starts here</SectionLabel>
              <h2 className="mt-5 text-3xl font-semibold tracking-[-.05em] text-white sm:text-5xl">Make decisions you can hear — and understand.</h2>
              <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-ink-300">Bring in a track, choose a reference, and start shaping your sound with tools that stay in your hands.</p>
              <button type="button" onClick={onEnterStudio} className="group mt-8 rounded-lg bg-accent px-6 py-3.5 text-xs font-semibold text-[#10150a] transition hover:-translate-y-0.5 hover:bg-[#d5fa7a]">Open Sonora Studio <ArrowMark /></button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[.07] bg-[#07090c]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg text-accent">≋</span>
            <span className="text-xs font-semibold tracking-[.15em] text-white">SONORA</span>
            <span className="text-[10px] text-ink-600">Reference Studio</span>
          </div>
          <p className="text-[10px] leading-relaxed text-ink-600">Local-first audio workspace · Mixing · Reference matching · Mastering</p>
          <button type="button" onClick={onEnterStudio} className="text-left text-[10px] text-ink-400 transition hover:text-accent">Enter the studio ↗</button>
        </div>
      </footer>
    </div>
  );
}
