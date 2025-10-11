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

export type DeletionAdapters = {
  fetchThreadsPosts: (opts: { userId: string; accountId: string; limit?: number }) => Promise<any[]>;
  fetchUserReplies: (opts: { userId: string; accountId: string; limit?: number; providerUserId?: string }) => Promise<any[]>;
  getTokenForAccount: (opts: { userId: string; accountId: string }) => Promise<string | null>;
  deleteThreadsPostWithToken: (opts: { postId: string; token: string }) => Promise<void>;
  getScheduledAccount: (opts: { userId: string; accountId: string }) => Promise<{ providerUserId?: string } | null>;
  queryScheduled: (opts: { userId: string; accountId: string; postId: string }) => Promise<Array<{ PK: string; SK: string }>>;
  deleteScheduledItem: (opts: { PK: string; SK: string }) => Promise<void>;
  getConfigValue?: (key: string) => string | undefined;
  putLog?: (entry: any) => Promise<void> | void;
};