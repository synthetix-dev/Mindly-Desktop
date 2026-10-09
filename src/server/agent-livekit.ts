import { fileURLToPath } from 'node:url';
import {
  cli,
  defineAgent,
  llm,
  voice
} from '@livekit/agents';
// Using cli.runApp direct cast to bypass strictly typed WorkerOptions which changed in recent beta.
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    console.log('Voice agent connected to room:', ctx.room.name);

    // Initial chat context
    const chatCtx = new llm.ChatContext();
    chatCtx.addMessage({
      role: 'system',
      content: 'You are a voice assistant in the OpenDots platform. Be concise, friendly, and helpful. Respond strictly in Ukrainian. Keep answers under 3 sentences.'
    });

    const agent = voice.Agent.create({
      instructions: 'You are a voice assistant in the OpenDots platform. Be concise, friendly, and helpful. Respond strictly in Ukrainian.',
      vad: await silero.VAD.load(),
      stt: new openai.STT(),
      llm: new openai.LLM({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
      }),
      tts: new openai.TTS(),
      chatCtx
    });

    const session = new voice.AgentSession();
    await session.start({ agent, room: ctx.room });
    
    // AI Agent says initial greeting
    await session.say('Привіт! Я штучний інтелект компанії OpenDots. Як я можу допомогти?', { allowInterruptions: true });
    console.log('AI Agent is now listening in the LiveKit room...');
  },
});

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp({
    agent: fileURLToPath(import.meta.url),
    wsURL: process.env.LIVEKIT_URL || 'ws://localhost',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  } as any);
}
