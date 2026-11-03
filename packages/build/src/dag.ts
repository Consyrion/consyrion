export interface TaskNode {
  key: string;
  dependsOn: string[];
}

/** Validates a task graph and returns the problems (duplicate keys, unknown dependencies, cycles). */
export function validateDag(tasks: TaskNode[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const task of tasks) {
    if (keys.has(task.key)) errors.push(`Duplicate task key ${task.key}`);
    keys.add(task.key);
  }
  for (const task of tasks) for (const dep of task.dependsOn) if (!keys.has(dep)) errors.push(`Task ${task.key} depends on unknown task ${dep}`);
  const state = new Map<string, "visiting" | "done">();
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const visit = (key: string, trail: string[]): void => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      errors.push(`Dependency cycle: ${[...trail, key].join(" → ")}`);
      return;
    }
    state.set(key, "visiting");
    for (const dep of byKey.get(key)?.dependsOn ?? []) if (byKey.has(dep)) visit(dep, [...trail, key]);
    state.set(key, "done");
  };
  for (const task of tasks) visit(task.key, []);
  return [...new Set(errors)];
}

/** Tasks whose dependencies are all done and that are still pending. */
export function readyTasks<T extends TaskNode & { status: string }>(tasks: T[]): T[] {
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.key));
  return tasks.filter((t) => t.status === "pending" && t.dependsOn.every((d) => done.has(d)));
}
