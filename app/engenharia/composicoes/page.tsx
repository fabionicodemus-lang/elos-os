import { redirect } from "next/navigation";

export default async function EngineeringCompositionsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; q?: string; group?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.service) query.set("service", params.service);
  if (params.q) query.set("q", params.q);
  if (params.group) query.set("group", params.group);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  redirect(`/engenharia/servicos${suffix}`);
}
