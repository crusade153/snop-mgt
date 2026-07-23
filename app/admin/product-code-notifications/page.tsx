import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/admin-auth";
import ProductCodeNotificationsClient from "./product-code-notifications-client";
import { getProductCodeNotifications } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProductCodeNotificationsPage() {
  const context = await getAdminContext();
  if (!context.user) redirect("/login");
  if (!context.isAdmin) redirect("/unauthorized");
  return <ProductCodeNotificationsClient {...await getProductCodeNotifications()} />;
}
