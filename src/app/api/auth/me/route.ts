import { connection, NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';

/** Which wallet is signed in. A signed-out visitor is a normal answer here, not an error. */
export async function GET() {
  await connection();
  const user = await currentUser();
  return NextResponse.json({ wallet: user?.wallet ?? null });
}
