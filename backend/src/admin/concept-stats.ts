import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { hasTable, type Section } from "./trainee-stats.js";

export interface ConceptStat {
  section: string;
  concept_id: string;
  asked: number;
  partial: number;
  wrong: number;
  assisted: number;
  final_wrong: number;
  open: number;
}

/**
 * Aggregate first-question verdicts from completed trainee checkpoints, retries included.
 * Returns an empty list until the checkpoint tables exist.
 */
export function conceptStats(db: DatabaseSync, section?: Section): { concepts: ConceptStat[] } {
  if (!hasTable(db, "attempts") || !hasTable(db, "concept_results")) return { concepts: [] };
  const open = hasTable(db, "misconceptions")
    ? `(SELECT COUNT(*) FROM misconceptions m
              JOIN users mu ON mu.id = m.user_id
             WHERE mu.role = 'trainee' AND m.section = a.section
               AND m.concept_id = c.concept_id AND m.resolved = 0)`
    : "0";
  const params: SQLInputValue[] = section ? [section] : [];
  const rows = db.prepare(`
    SELECT a.section, c.concept_id,
           COUNT(*) AS asked,
           SUM(CASE WHEN c.verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
           SUM(CASE WHEN c.verdict = 'wrong' THEN 1 ELSE 0 END) AS wrong,
           SUM(CASE WHEN c.verdict = 'assisted' THEN 1 ELSE 0 END) AS assisted,
           SUM(CASE WHEN c.recheck_verdict = 'wrong' THEN 1 ELSE 0 END) AS final_wrong,
           ${open} AS open
      FROM concept_results c
      JOIN attempts a ON a.id = c.attempt_id
      JOIN users u ON u.id = a.user_id
     WHERE u.role = 'trainee' AND a.state = 'completed'${section ? " AND a.section = ?" : ""}
     GROUP BY a.section, c.concept_id
     ORDER BY a.section, c.concept_id
  `).all(...params);
  return { concepts: rows.map((row) => ({
    section: String(row.section), concept_id: String(row.concept_id),
    asked: Number(row.asked), partial: Number(row.partial), wrong: Number(row.wrong),
    assisted: Number(row.assisted), final_wrong: Number(row.final_wrong), open: Number(row.open),
  })) };
}
