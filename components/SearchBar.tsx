'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} className="top-search">
      <input
        type="text"
        placeholder="Hledat videa nebo tvůrce…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit">Hledat</button>
    </form>
  );
}
