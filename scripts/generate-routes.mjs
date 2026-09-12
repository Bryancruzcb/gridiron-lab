/** Rebuild src/routeTree.gen.ts from src/routes/. Same file Vite writes on `npm run dev`. */
import { Generator, getConfig } from "@tanstack/router-generator";

const root = process.cwd();
const config = getConfig({}, root);
await new Generator({ config, root }).run();
