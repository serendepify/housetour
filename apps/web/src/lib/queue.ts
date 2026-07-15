import { Queue } from "bullmq";
import { env } from "./env";

let tourQueue: Queue | null = null;

export function getTourQueue(): Queue {
  if (!tourQueue) {
    const redisUrl = new URL(env.redisUrl);
    tourQueue = new Queue("tour-process", {
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        username: redisUrl.username || undefined,
        password: redisUrl.password || undefined,
        db: Number(redisUrl.pathname.slice(1) || 0),
        tls: redisUrl.protocol === "rediss:" ? {} : undefined,
        maxRetriesPerRequest: null,
      },
    });
  }
  return tourQueue;
}

export async function enqueueTourProcess(
  jobId: string,
  tourId: string,
  mode: "pano" | "photogrammetry" = "pano",
  captureSessionId?: string,
) {
  const queue = getTourQueue();
  const job = await queue.add(
    mode === "photogrammetry" ? "photogrammetry" : "process",
    { jobId, tourId, mode, captureSessionId },
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
