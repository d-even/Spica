import type { Metadata } from 'next';
import { SignupForm } from '@/components/spica/SignupForm';

export const metadata: Metadata = { title: 'Create account | SPICA' };

export default function Signup() {
  return <SignupForm />;
}
