import { Sprite } from './PixelCharacter';

export const ROBOT_POSES = ['idle', 'tablet', 'point', 'thumbs'] as const;
export type RobotPose = (typeof ROBOT_POSES)[number];

/** Where the eyes sit in each pose, as a percentage of the sprite. */
const EYES: Record<RobotPose, { left: string; top: string; width: string; height: string }> = {
  idle: { left: '26%', top: '56%', width: '22%', height: '5.5%' },
  tablet: { left: '32%', top: '56%', width: '20%', height: '6%' },
  point: { left: '33%', top: '59.5%', width: '20%', height: '5.5%' },
  thumbs: { left: '29%', top: '60%', width: '20%', height: '5%' },
};

/** The SPICA robot: bounces, blinks, and swaps poses from the brand animation. */
export function SPICARobot({ pose = 'idle', poses = [pose], animated = true }: { pose?: RobotPose; poses?: readonly RobotPose[]; animated?: boolean }) {
  return (
    <span className={`block ${animated ? 's-bounce' : ''}`}>
      <Sprite name="robot" pose={pose} poses={poses} width={368} height={765}>
        {animated && <i className="s-blink" style={{ ...EYES[pose], background: '#1a1a26' }} aria-hidden />}
      </Sprite>
    </span>
  );
}
