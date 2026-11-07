import type { Metadata } from 'next';
import { LoginForm } from '@/components/spica/LoginForm';

export const metadata: Metadata = { title: 'Login | SPICA' };

export default function Login() {
  return <LoginForm />;
}
