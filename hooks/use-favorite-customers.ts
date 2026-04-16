'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface FavoriteCustomer {
  kunnr: string;
  customer_name: string;
  created_at: string;
}

async function fetchFavoriteCustomers(): Promise<FavoriteCustomer[]> {
  const res = await fetch('/api/favorite-customers');
  if (!res.ok) return [];
  const json = await res.json();
  return json.favorites || [];
}

export function useFavoriteCustomers() {
  const qc = useQueryClient();

  const { data: favoriteCustomers = [] } = useQuery<FavoriteCustomer[]>({
    queryKey: ['favorite-customers'],
    queryFn: fetchFavoriteCustomers,
    staleTime: 1000 * 60 * 5,
  });

  const isFavoriteCustomer = (kunnr: string) => favoriteCustomers.some((f) => f.kunnr === kunnr);

  const addMutation = useMutation({
    mutationFn: ({ kunnr, customer_name }: { kunnr: string; customer_name: string }) =>
      fetch('/api/favorite-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kunnr, customer_name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorite-customers'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (kunnr: string) =>
      fetch(`/api/favorite-customers?kunnr=${encodeURIComponent(kunnr)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorite-customers'] }),
  });

  const toggleCustomer = (kunnr: string, customer_name: string) => {
    if (isFavoriteCustomer(kunnr)) {
      removeMutation.mutate(kunnr);
    } else {
      addMutation.mutate({ kunnr, customer_name });
    }
  };

  return { favoriteCustomers, isFavoriteCustomer, toggleCustomer };
}
