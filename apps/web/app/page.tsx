import { auth } from "../auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  // Redirect authenticated users to the dashboard (canvas)
  redirect("/dashboard");
}
