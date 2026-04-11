'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Favorite {
  matnr: string;
  product_name: string;
  created_at: string;
}

async function fetchFavorites(): Promise<Favorite[]> {
  const res = await fetch('/api/favorites');
  if (!res.ok) return [];
  const json = await res.json();
  return json.favorites || [];
}

export function useFavorites() {
  const qc = useQueryClient();

  const { data: favorites = [] } = useQuery<Favorite[]>({
    queryKey: ['favorites'],
    queryFn: fetchFavorites,
    staleTime: 1000 * 60 * 5,
  });

  const isFavorite = (matnr: string) => favorites.some((f) => f.matnr === matnr);

  const addMutation = useMutation({
    mutationFn: ({ matnr, product_name }: { matnr: string; product_name: string }) =>
      fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matnr, product_name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (matnr: string) =>
      fetch(`/api/favorites?matnr=${encodeURIComponent(matnr)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const toggle = (matnr: string, product_name: string) => {
    if (isFavorite(matnr)) {
      removeMutation.mutate(matnr);
    } else {
      addMutation.mutate({ matnr, product_name });
    }
  };

  return { favorites, isFavorite, toggle };
}
