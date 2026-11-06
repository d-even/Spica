import { NeuralNetworkBackground } from './NeuralNetworkBackground';

export function HeroSection() {
  return (
    <section id="top" className="n-hero">
      <NeuralNetworkBackground />
      <div className="n-hero-veil" />
      <div className="n-hero-content">
        <p className="n-eyebrow n-enter">The intelligence layer for autonomous commerce</p>
        <h1 className="n-enter n-enter-2">
          Let AI Agents
          <br />
          <em>Move Money</em> Intelligently.
        </h1>
        <p className="n-hero-text n-enter n-enter-3">
          Discover services. Compare providers. Pay autonomously. Stay in control of every transaction.
        </p>
        <div className="n-actions n-enter n-enter-4">
          <a href="#how-it-works" className="n-button">Explore NORA</a>
          <a href="#developers" className="n-button n-button-ghost">For Developers</a>
        </div>
        <p className="n-powered n-enter n-enter-5">Powered by Arc <span>×</span> Hedera</p>
      </div>
    </section>
  );
}
