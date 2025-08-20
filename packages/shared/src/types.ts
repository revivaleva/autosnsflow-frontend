// /packages/shared/src/types.ts
export type UserId = string;
export type ThreadsAccountId = string;

export type ScheduledPostStatus = "" | "pending" | "posted";

export type PersonaMode = "simple" | "detail";

export type Persona = {
  personaSimple?: string;
  personaDetail?: string;
  personaMode: PersonaMode;
};

export type GeneratePromptInput = {
  masterPrompt: string;
  theme: string;
  persona: Persona;
};

export type DiscordLogLevel = "INFO" | "ERROR";
