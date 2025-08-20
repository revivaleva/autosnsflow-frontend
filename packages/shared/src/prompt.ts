// /packages/shared/src/prompt.ts
import type { GeneratePromptInput } from "./types";

// personaMode によって simple/detail を使い分け、マスタ＋テーマを合成
export function buildGeneratePrompt(input: GeneratePromptInput): string {
  const { masterPrompt, theme, persona } = input;
  const personaText =
    persona.personaMode === "simple"
      ? (persona.personaSimple || "")
      : (persona.personaDetail || "");

  const blocks = [
    masterPrompt?.trim(),
    personaText?.trim(),
    `テーマ: ${theme?.trim()}`,
  ].filter(Boolean);

  return blocks.join("\n\n");
}
