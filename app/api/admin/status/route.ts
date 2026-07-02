import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAdminContext();

  return NextResponse.json(
    {
      isAdmin: context.isAdmin,
      isActive: context.isActive,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
