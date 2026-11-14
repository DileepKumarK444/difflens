import type { Progress } from "@/lib/ai/engine";

/** In-memory progress for reviews running in this server process. Results live in SQLite. */
const g = globalThis as unknown as { __difflensJobs?: Map<string, Progress>; __difflensSendConfirmed?: boolean };
const jobs = (g.__difflensJobs ??= new Map());

export const setProgress = (id: string, p: Progress) => void jobs.set(id, p);
export const getProgress = (id: string): Progress | null => jobs.get(id) ?? null;
export const clearProgress = (id: string) => void jobs.delete(id);
export const isRunning = (id: string) => jobs.has(id);

/** "Ask once per session": remembered until the server restarts. */
export const sessionConfirmed = () => g.__difflensSendConfirmed === true;
export const confirmSession = () => void (g.__difflensSendConfirmed = true);
