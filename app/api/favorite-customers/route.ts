import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function createSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try { cookieStore.set(name, value, options); } catch {}
          });
        },
      },
    }
  );
}

// GET /api/favorite-customers
export async function GET() {
  const supabase = await createSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('user_favorite_customers')
    .select('kunnr, customer_name, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ favorites: data });
}

// POST /api/favorite-customers
export async function POST(req: NextRequest) {
  const supabase = await createSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { kunnr, customer_name } = await req.json();
  if (!kunnr) return NextResponse.json({ error: 'kunnr required' }, { status: 400 });

  const { error } = await supabase
    .from('user_favorite_customers')
    .upsert({ user_id: user.id, kunnr, customer_name }, { onConflict: 'user_id,kunnr' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/favorite-customers?kunnr=xxx
export async function DELETE(req: NextRequest) {
  const supabase = await createSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const kunnr = req.nextUrl.searchParams.get('kunnr');
  if (!kunnr) return NextResponse.json({ error: 'kunnr required' }, { status: 400 });

  const { error } = await supabase
    .from('user_favorite_customers')
    .delete()
    .eq('user_id', user.id)
    .eq('kunnr', kunnr);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
