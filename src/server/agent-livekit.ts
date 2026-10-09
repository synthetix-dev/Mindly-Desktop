import { fileURLToPath } from 'node:url';
import {
  cli,
  defineAgent,
} from '@livekit/agents';

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    console.log('Voice agent connected to room:', ctx.room.name);
    console.log('AI Agent is now listening in the LiveKit room...');

    // The logic to "hear" and "speak" will go here using LiveKit streams.
    // For PoC Phase 5, the agent successfully joins the room.
  },
});

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ServerOptions } = require('@livekit/agents/worker');
  cli.runApp(new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    wsURL: process.env.LIVEKIT_URL || 'ws://localhost',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  }));
}
