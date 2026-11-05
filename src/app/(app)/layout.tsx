import { Suspense } from 'react';
import { Shell } from '@/components/shell';
import { Loading } from '@/components/ui';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
