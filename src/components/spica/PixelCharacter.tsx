import Image from 'next/image';

export const HUMAN_POSES = ['idle', 'offer', 'think', 'cheer', 'happy', 'receipt'] as const;
export type HumanPose = (typeof HUMAN_POSES)[number];

/** Every pose shares one canvas and feet line, so swapping poses never shifts the character. */
export function Sprite<Pose extends string>({ name, pose, poses, width, height, children }: { name: string; pose: Pose; poses: readonly Pose[]; width: number; height: number; children?: React.ReactNode }) {
  return (
    <span className="s-sprite" style={{ '--ratio': `${width} / ${height}` } as React.CSSProperties}>
      {poses.map((item) => (
        <Image key={item} src={`/spica/${name}-${item}.webp`} alt="" width={width} height={height} unoptimized data-on={item === pose} />
      ))}
      {children}
    </span>
  );
}

/** The pixel-art person from the brand animation. Pass `poses` to preload a set for instant swaps. */
export function PixelCharacter({ pose = 'idle', poses = [pose], animated = true }: { pose?: HumanPose; poses?: readonly HumanPose[]; animated?: boolean }) {
  return (
    <span className={`block ${animated && pose !== 'cheer' ? 's-breathe' : ''}`}>
      <Sprite name="human" pose={pose} poses={poses} width={450} height={765}>
        {/* Only the front-facing idle pose blinks; the others look away or smile. */}
        {animated && pose === 'idle' && <i className="s-blink" style={{ left: '49.5%', top: '52%', width: '12%', height: '3.6%', background: '#eec39a' }} aria-hidden />}
      </Sprite>
    </span>
  );
}
