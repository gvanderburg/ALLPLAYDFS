import app from "./app";
import { logger } from "./lib/logger";
import { recoverInterruptedEvaluations } from "./lib/model-evaluation/service";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try { await recoverInterruptedEvaluations(); }
catch (err) { logger.error({ err }, "Could not recover interrupted evaluations; apply the evaluation schema before using owner research tools"); }
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
