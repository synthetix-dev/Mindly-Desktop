import { fileURLToPath } from 'node:url';
import {
  cli,
  defineAgent,
  llm,
  voice
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';

class PlatformLLM extends llm.LLM {
  private roomId: string;
  private endpoint: string;

  constructor(roomId: string, endpoint: string = 'http://127.0.0.1:4310/api/copilotkit/livekit/turn') {
    super();
    this.roomId = roomId;
    this.endpoint = endpoint;
  }

  label(): string { return 'PlatformLLM'; }
  get model(): string { return 'opendots-agent'; }
  get provider(): string { return 'opendots'; }

  chat({ chatCtx, toolCtx, connOptions }: any): llm.LLMStream {
    const stream = new (class extends llm.LLMStream {
      constructor(llm: llm.LLM) {
        super(llm, { chatCtx, connOptions: connOptions || {} });
        this.runPromise = this.run();
      }
      runPromise: Promise<void>;
      async run() {
        try {
          const msgs = (this.chatCtx as any).messages; const lastMsg = msgs[msgs.length - 1];
          if (!lastMsg || lastMsg.role !== 'user' || typeof lastMsg.content !== 'string') {
            return; // Only respond to user messages
          }
          
          const prompt = lastMsg.content;
          
          const res = await fetch(((this as any).llm).endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomId: ((this as any).llm).roomId,
              prompt: prompt
            })
          });
          
          if (!res.ok) {
            throw new Error(`Platform API error: ${res.status}`);
          }
          
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          (this as any).output.push({
            id: 'id',
            delta: { role: 'assistant', content: data.text }
          });
        } catch (e: any) {
          console.error('PlatformLLM run error:', e);
          (this as any).output.push({
            id: 'error',
            delta: { role: 'assistant', content: "Вибачте, сталася помилка з'єднання з агентом." }
          });
        } finally {
          this.output.close();
        }
      }
    })(this);
    
    return stream;
  }
}

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    console.log('Voice agent connected to room:', ctx.room.name);

    const chatCtx = new llm.ChatContext();
    chatCtx.addMessage({
      role: 'system',
      content: 'You are a voice assistant in the OpenDots platform. Be concise, friendly, and helpful. Respond strictly in Ukrainian. Keep answers under 3 sentences.'
    });

    const agent = voice.Agent.create({
      instructions: 'You are a voice assistant in the OpenDots platform. Be concise, friendly, and helpful. Respond strictly in Ukrainian.',
      vad: await silero.VAD.load(),
      stt: new openai.STT(),
      llm: new PlatformLLM(ctx.room.name || 'default-room'),
      tts: new openai.TTS(),
      chatCtx
    });

    const session = new voice.AgentSession();
    await session.start({ agent, room: ctx.room });
    
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
