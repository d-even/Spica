import { AuthLayout } from '@/components/spica/AuthLayout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="spica">
      <AuthLayout>{children}</AuthLayout>
    </div>
  );
}
