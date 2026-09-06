import { DelayedError } from "bullmq";

export interface DelayedWorkerJob {
  token?: string;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export const rescheduleRateLimitedJob = async (
  job: DelayedWorkerJob,
  nextAvailableAt: Date,
  now = new Date(),
): Promise<never> => {
  const timestamp = Math.max(nextAvailableAt.getTime(), now.getTime() + 1);
  await job.moveToDelayed(timestamp, job.token);
  throw new DelayedError();
};
