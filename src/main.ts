import { GameApp } from "./app/GameApp.js";

async function main(): Promise<void> {
  const app = await GameApp.create();
  app.start();
}

main().catch(console.error);
