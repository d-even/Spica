'use client';

import { CheckCircle2, CloudSun, Loader2, Newspaper, Pause, Play, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HUMAN_POSES, PixelCharacter, type HumanPose } from './PixelCharacter';
import { ROBOT_POSES, SPICARobot, type RobotPose } from './SPICARobot';
import { SPICALogo } from './SPICALogo';
import { SpeechBubble } from './SpeechBubble';

type SceneId = 'ask' | 'search' | 'found' | 'budget' | 'limit' | 'paid' | 'logo' | 'idle';

/** The loop. Each beat sets both poses, then the overlays below react to its id. */
const SCENES: { id: SceneId; ms: number; human: HumanPose; robot: RobotPose }[] = [
  { id: 'ask', ms: 2600, human: 'idle', robot: 'idle' },
  { id: 'search', ms: 2200, human: 'offer', robot: 'tablet' },
  { id: 'found', ms: 2400, human: 'think', robot: 'tablet' },
  { id: 'budget', ms: 1500, human: 'think', robot: 'point' },
  { id: 'limit', ms: 1700, human: 'think', robot: 'point' },
  { id: 'paid', ms: 2400, human: 'cheer', robot: 'thumbs' },
  { id: 'logo', ms: 2400, human: 'happy', robot: 'thumbs' },
  { id: 'idle', ms: 1300, human: 'idle', robot: 'idle' },
];
/** With reduced motion the scene holds on the payment, which tells the whole story. */
const STILL = SCENES.findIndex((scene) => scene.id === 'paid');

const PIXELS = [
  [8, 18], [23, 9], [37, 22], [64, 8], [79, 20], [92, 11], [14, 44], [90, 46],
].map(([left, top], index) => ({ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 0.45}s` }));

const CONFETTI = Array.from({ length: 14 }, (_, index) => {
  const angle = (index / 14) * Math.PI * 2;
  return {
    '--dx': `${Math.round(Math.cos(angle) * 22)}cqw`,
    '--dy': `${Math.round(Math.sin(angle) * 15)}cqw`,
    '--c': ['#ffe34d', '#f04b2d', '#a9e8b7'][index % 3],
  } as React.CSSProperties;
});

const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Overlay({ id }: { id: SceneId }) {
  if (id === 'ask') {
    return <SpeechBubble style={{ left: '8%', top: '8%', maxWidth: '40%' }}>Find me a weather API for Pune.</SpeechBubble>;
  }
  if (id === 'search') {
    return (
      <>
        <SpeechBubble side="right" style={{ right: '11%', top: '13%' }}>
          <span className="inline-flex items-center gap-[1cqw]"><Search className="size-[3.2cqw] min-h-3 min-w-3" aria-hidden /> On it! Searching…</span>
        </SpeechBubble>
        <div className="s-float" style={{ left: '37%', top: '30%' }}><span className="s-mini"><CloudSun className="size-[3cqw] min-h-3 min-w-3" aria-hidden /> Weather</span></div>
        <div className="s-float" style={{ left: '12%', top: '11%', animationDelay: '120ms, 400ms' }}><span className="s-mini"><Newspaper className="size-[3cqw] min-h-3 min-w-3" aria-hidden /> News</span></div>
        <div className="s-float" style={{ left: '30%', top: '19%', animationDelay: '220ms, 500ms' }}><span className="s-mini"><TrendingUp className="size-[3cqw] min-h-3 min-w-3" aria-hidden /> Finance</span></div>
      </>
    );
  }
  if (id === 'found') {
    return (
      <div className="s-float" style={{ left: '35%', top: '9%' }}>
        <div className="s-scene-card s-scene-card-yellow">
          <span className="inline-flex items-center gap-[1cqw]"><CloudSun className="size-[3.6cqw] min-h-3.5 min-w-3.5" aria-hidden /> Weather API</span>
          <small>Price: $0.01</small>
        </div>
      </div>
    );
  }
  if (id === 'budget' || id === 'limit') {
    const done = id === 'limit';
    return (
      <div className="s-float" style={{ left: '30%', top: '9%' }}>
        <div className={`s-scene-card ${done ? 's-scene-card-mint' : ''}`}>
          <span className="inline-flex items-center gap-[1cqw]">
            {done ? <ShieldCheck className="size-[3.6cqw] min-h-3.5 min-w-3.5" aria-hidden /> : <Loader2 className="size-[3.6cqw] min-h-3.5 min-w-3.5 animate-spin" aria-hidden />}
            {done ? 'Within spending limit' : 'Budget check...'}
          </span>
          <div className="s-meter"><i /></div>
        </div>
      </div>
    );
  }
  if (id === 'paid') {
    return (
      <div className="s-float" style={{ left: '37%', top: '12%' }}>
        <div className="s-scene-card s-scene-card-mint">
          <span className="inline-flex items-center gap-[1cqw]"><CheckCircle2 className="size-[3.6cqw] min-h-3.5 min-w-3.5" aria-hidden /> Payment approved!</span>
          <small>$0.01 USDC</small>
        </div>
      </div>
    );
  }
  if (id === 'logo') {
    return (
      <>
        <div className="s-scene-logo"><SPICALogo variant="login" size={999} wordmark={false} className="[&_img]:h-auto [&_img]:w-full" /></div>
        {CONFETTI.map((style, index) => <i key={index} className="s-confetti" style={style} />)}
      </>
    );
  }
  return null;
}

/** The hero: a person asks, the robot finds an API, the firewall checks it, and SPICA pays. */
export function HeroAnimation() {
  const reduced = useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);

  // Stop the timeline while the hero is off screen.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || paused || !visible) return;
    const timer = setTimeout(() => setIndex((current) => (current + 1) % SCENES.length), SCENES[index].ms);
    return () => clearTimeout(timer);
  }, [index, paused, reduced, visible]);

  const scene = SCENES[reduced ? STILL : index];

  return (
    <div
      ref={stage}
      className="s-stage"
      data-scene={scene.id}
      role="img"
      aria-label="A pixel-art person asks a small robot for a weather API. The robot finds one for $0.01, checks it against the spending limit, and the payment is approved."
    >
      <div className="s-pixels" aria-hidden>
        {PIXELS.map((style, position) => <i key={position} className="s-pixel" style={style} />)}
      </div>
      <i className="s-floor s-floor-human" aria-hidden />
      <i className="s-floor s-floor-robot" aria-hidden />
      <div className="s-sprite-frame s-sprite-human"><PixelCharacter pose={scene.human} poses={HUMAN_POSES} animated={!reduced} /></div>
      <div className="s-sprite-frame s-sprite-robot"><SPICARobot pose={scene.robot} poses={ROBOT_POSES} animated={!reduced} /></div>
      {/* The key replays each overlay's entrance when its beat starts. */}
      <div key={scene.id} aria-hidden><Overlay id={scene.id} /></div>
      {!reduced && (
        <button type="button" className="s-stage-pause" onClick={() => setPaused(!paused)} aria-label={paused ? 'Play animation' : 'Pause animation'}>
          {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
        </button>
      )}
    </div>
  );
}
