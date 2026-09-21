import { CaseDetail } from "@/components/case/CaseDetail";

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <CaseDetail caseId={caseId} />;
}
