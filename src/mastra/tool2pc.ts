import { RuntimeContext } from "@mastra/core/runtime-context";

export function setTool2PC({
  runtimeContext,
  tryCommit,
  commit,
  rollback,
}: {
  runtimeContext: RuntimeContext<unknown>;
  tryCommit: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}) {
  const tryCommits = (runtimeContext.get("tryCommit") ||
    []) as (() => Promise<void>)[];
  const commits = (runtimeContext.get("commit") ||
    []) as (() => Promise<void>)[];
  const rollbacks = (runtimeContext.get("rollback") ||
    []) as (() => Promise<void>)[];

  tryCommits.push(tryCommit);
  commits.push(commit);
  rollbacks.push(rollback);

  runtimeContext.set("tryCommit", tryCommits);
  runtimeContext.set("commit", commits);
  runtimeContext.set("rollbacks", rollbacks);
}

export async function run2PC(runtimeContext: RuntimeContext<unknown>) {
  const tryCommits = (runtimeContext.get("tryCommit") ||
    []) as (() => Promise<void>)[];
  const commits = (runtimeContext.get("commit") ||
    []) as (() => Promise<void>)[];
  const rollbacks = (runtimeContext.get("rollback") ||
    []) as (() => Promise<void>)[];
  console.log("2pc", { tryCommits, commits, rollbacks });

  try {
    // try commit
    for (const tc of tryCommits) await tc();
  } catch (e) {
    console.log("2pc failed", e);
    // rollback + exit
    for (const r of rollbacks) await r();
    return;
  }
  console.log("2pc committing");

  // final commit
  for (const c of commits) await c();
  console.log("2pc committed");
}
