// -----------------------------------------------------------------------------
// LLM backend factory. Supports two KaibanJS wiring styles:
//   1. llmConfig   -> built-in provider (anthropic)
//   2. llmInstance -> a custom LangChain model (AWS Bedrock: Nova, Qwen, ...)
//
// buildLlm() accepts an optional per-agent model override, which lets a single
// crew run different agents on different models (multi-model routing demo).
// -----------------------------------------------------------------------------

import { ChatBedrockConverse } from '@langchain/aws';

const PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();

export function buildLlm({ model } = {}) {
  if (PROVIDER === 'bedrock') {
    const chosen = model || process.env.BEDROCK_MODEL;
    if (!chosen) throw new Error('BEDROCK_MODEL is required when LLM_PROVIDER=bedrock');
    return {
      llmInstance: new ChatBedrockConverse({
        model: chosen,
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.3,
      }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  return {
    llmConfig: {
      provider: 'anthropic',
      model: model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620',
      apiKey,
      temperature: 0.3,
    },
  };
}

export function activeProvider() {
  if (PROVIDER === 'bedrock') return `AWS Bedrock · ${process.env.AWS_REGION} · ${process.env.BEDROCK_MODEL}`;
  return `Anthropic · ${process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620'}`;
}

// Which model a given agent should use. Env overrides let you demo multi-model
// routing without touching code, e.g. MODEL_ALEX=qwen.qwen3-coder-30b-a3b-v1:0
export function modelFor(agentKey) {
  return process.env[`MODEL_${agentKey.toUpperCase()}`] || undefined;
}
