import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

let connection: IORedis | null = null;
let tourQueue: Queue | null = null;

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getTourQueue(): Queue {
  if (!tourQueue) {
    // Cast: pnpm may hoist two ioredis majors; runtime is fine
    tourQueue = new Queue("tour-process", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: getRedis() as any,
    });
  }
  return tourQueue;
}

export async function enqueueTourProcess(
  jobId: string,
  tourId: string,
  mode: "pano" | "photogrammetry" = "pano",
) {
  const queue = getTourQueue();
  const job = await queue.add(
    mode === "photogrammetry" ? "photogrammetry" : "process",
    { jobId, tourId, mode },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );
  return job;
}
