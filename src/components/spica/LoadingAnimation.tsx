import { SPICALogo } from './SPICALogo';

export function LoadingAnimation({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="s-loading">
      <span className="s-bounce">
        <SPICALogo variant="loading" />
      </span>
      {label}
    </div>
  );
}
