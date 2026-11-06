import { Footer } from '@/components/spica/Footer';
import { Navbar } from '@/components/spica/Navbar';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="spica flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
