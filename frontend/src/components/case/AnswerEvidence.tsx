/**
 * One evidence item as the *answer file* carries it.
 *
 * Distinct from `EvidenceItem`, which renders a live ledger posting and can
 * therefore show how far the probability moved. The graded file keeps exactly
 * four fields per item — claim, source, ref, entity_ids — because anything
 * beyond them is an extra key in a scored payload, so there is no likelihood
 * ratio to draw here and pretending otherwise would be inventing one.
 *
 * The ref is the load-bearing part: an analyst reading a case has to be able
 * to re-run any single line of it.
 */

import { EntityChip } from "@/components/ui/EntityChip";
import { RefChip } from "@/components/ui/RefChip";
import { SourceIcon } from "@/components/ui/SourceIcon";
import type { Evidence } from "@/lib/generated/contract";

export function AnswerEvidence({ item }: { item: Evidence }) {
  return (
    <div className="grid grid-cols-[16px_1fr] items-start gap-2 border-b border-border py-2.5 last:border-0">
      <SourceIcon source={item.source} className="mt-0.5" />
      <div className="min-w-0 space-y-1.5">
        <p className="text-small text-fg">{item.claim}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <RefChip value={item.ref} />
          {item.entity_ids.map((id) => (
            <EntityChip key={id} id={id} />
          ))}
        </div>
      </div>
    </div>
  );
}
