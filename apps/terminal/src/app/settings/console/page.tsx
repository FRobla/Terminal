import { redirect } from "next/navigation";

export default function OwnerConsoleIndexPage() {
  redirect("/settings/console/overview");
}
