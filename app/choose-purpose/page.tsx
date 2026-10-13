import { redirect } from 'next/navigation';

/** Starší adresa jednoho kroku vítání - všechny kroky jsou teď v průvodci /welcome. */
export default function OldOnboardingStep() {
  redirect('/welcome');
}
