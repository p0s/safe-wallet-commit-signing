#!/usr/bin/env node
import { main } from "../dist/cli.js";

main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
