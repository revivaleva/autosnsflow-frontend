export function buildQuotePrompt({ policyPrompt = "", personaText = "", sourcePost = "", masterPrompt = "" }: { policyPrompt?: string; personaText?: string; sourcePost?: string; masterPrompt?: string; }) {
  const systemPrompt = "あなたはSNS運用代行のプロです。" + (policyPrompt ? `\n【運用方針】\n${policyPrompt}` : "");

  const policyBlock = policyPrompt ? `【運用方針】\n${policyPrompt}\n\n` : "";
  const personaBlock = personaText ? `【アカウントのペルソナ】\n${personaText}\n\n` : `【アカウントのペルソナ】\n(未設定)\n\n`;
  const sourceBlock = sourcePost ? `【引用元投稿】\n${sourcePost}\n\n` : `【投稿テーマ】\n${String(sourcePost || "")}\n\n`;
  const defaultQuoteInstruction = `【指示】\n上記の引用元投稿に自然に反応する形式で、共感や肯定、専門性を含んだ引用投稿文を作成してください。200〜400文字以内。ハッシュタグ禁止。改行は最大1回。`;

  const userPrompt = [policyBlock, personaBlock, sourceBlock, defaultQuoteInstruction].filter(Boolean).join('\n\n');
  const max_tokens = 600;
  return { systemPrompt, userPrompt, max_tokens };
}


