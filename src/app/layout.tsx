import type { Metadata } from 'next';
import { Anton, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import '@/components/spica/spica.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] });
const anton = Anton({ weight: '400', variable: '--font-anton', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SPICA',
  description: 'The intelligent payment and trust infrastructure for autonomous AI agents.',
};

/** Applies a saved theme before first paint, so it never flashes. */
const themeScript = `try{var t=localStorage.getItem('paygate-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${jetbrains.variable} ${anton.variable} min-h-screen`}>{children}</body>
    </html>
  );
}
