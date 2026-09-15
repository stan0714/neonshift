import { main } from "./service.js";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
