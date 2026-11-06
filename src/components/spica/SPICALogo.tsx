import Image from 'next/image';

type Variant = 'navbar' | 'footer' | 'login' | 'loading';

const HEIGHTS: Record<Variant, number> = { navbar: 42, footer: 44, login: 104, loading: 56 };

/** The artwork is the supplied logo, unchanged. Only its height varies, so it never distorts. */
export function SPICALogo({ variant = 'navbar', size, wordmark = variant !== 'loading', className = '' }: { variant?: Variant; size?: number; wordmark?: boolean; className?: string }) {
  const height = size ?? HEIGHTS[variant];
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image src="/spica/logo.webp" alt={wordmark ? '' : 'SPICA'} width={Math.round((height * 403) / 480)} height={height} unoptimized priority={variant === 'navbar' || variant === 'login'} />
      {wordmark && (
        <span className="s-display" style={{ fontSize: Math.round(height * (variant === 'login' ? 0.62 : 0.66)) }}>
          SPICA
        </span>
      )}
    </span>
  );
}
