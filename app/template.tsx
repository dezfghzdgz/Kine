'use client';

export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-transition-fade">{children}</div>;
}
