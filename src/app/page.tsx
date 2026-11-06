import type { Metadata } from 'next';
import { Instrument_Serif } from 'next/font/google';
import { ArcSection } from '@/components/nora/ArcSection';
import { DeveloperSection } from '@/components/nora/DeveloperSection';
import { FinalCTA, Footer } from '@/components/nora/FinalCTA';
import { FirewallSection } from '@/components/nora/FirewallSection';
import { HederaSection, RolesStrip } from '@/components/nora/HederaSection';
import { HeroSection } from '@/components/nora/HeroSection';
import { HowItWorks } from '@/components/nora/HowItWorks';
import { Navbar } from '@/components/nora/Navbar';
import '@/components/nora/nora.css';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-nora-serif' });

export const metadata: Metadata = {
  title: 'NORA | The Financial Infrastructure for AI Agents',
  description: 'NORA connects AI agents, developers and services through intelligent spending controls, Arc payments and Hedera trust.',
};

export default function Home() {
  return (
    <div className={`nora ${serif.variable}`}>
      <Navbar />
      <main>
        <HeroSection />
        <HowItWorks />
        <ArcSection />
        <HederaSection />
        <RolesStrip />
        <FirewallSection />
        <DeveloperSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
