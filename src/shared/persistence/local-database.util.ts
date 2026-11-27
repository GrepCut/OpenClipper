import { invoke } from "@tauri-apps/api/core";
import type { User } from "../types/auth.types";
import { isTauri } from "../utils/platform.util";
import { LOCAL_WORKSPACE_OWNER_ID } from "./local-workspace.util";

const WEB_PREFIX = "openclipper_local_db:";
const inFlightReads = new Map<string, Promise<unknown>>();

function webKey(namespace: string, key: string): string {
  return `${WEB_PREFIX}${namespace}:${key}`;
}

let webWorkspaceMigrated = false;

function migrateWebProjectsToSharedWorkspace(): void {
  if (webWorkspaceMigrated || isTauri()) return;
  webWorkspaceMigrated = true;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(webKey("project-owner", ""))) continue;
    localStorage.setItem(key, LOCAL_WORKSPACE_OWNER_ID);
  }
}

/**
 * Coalesces only concurrent, identical native reads. Results are never cached:
 * once a read settles, the next caller starts a new IPC request.
 */
function singleFlightRead<T>(
  requestKey: string,
  read: () => Promise<T>,
): Promise<T> {
  const existing = inFlightReads.get(requestKey) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = read();
  inFlightReads.set(requestKey, pending);
  void pending.then(
    () => {
      if (inFlightReads.get(requestKey) === pending) {
        inFlightReads.delete(requestKey);
      }
    },
    () => {
      if (inFlightReads.get(requestKey) === pending) {
        inFlightReads.delete(requestKey);
      }
    },
  );
  return pending;
}

export interface LocalProjectListQuery {
  ownerId: string;
  page: number;
  limit: number;
  search?: string;
  projectType?: string;
  sortBy?: "createdAt" | "updatedAt";
}

export async function localRecordGet<T>(
  namespace: string,
  key: string,
): Promise<T | null> {
  if (!isTauri()) {
    migrateWebProjectsToSharedWorkspace();
    const raw = localStorage.getItem(webKey(namespace, key));
    return raw ? (JSON.parse(raw) as T) : null;
  }
  return singleFlightRead(
    JSON.stringify(["local_record_get", namespace, key]),
    () => invoke<T | null>("local_record_get", { namespace, key }),
  );
}

export async function localRecordPut<T>(
  namespace: string,
  key: string,
  projectId: string | null,
  payload: T,
): Promise<T> {
  if (!isTauri()) {
    localStorage.setItem(webKey(namespace, key), JSON.stringify(payload));
    return payload;
  }
  return invoke<T>("local_record_put", { namespace, key, projectId, payload });
}

export async function localRecordDelete(
  namespace: string,
  key: string,
): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(webKey(namespace, key));
    return;
  }
  await invoke("local_record_delete", { namespace, key });
}

export async function localProjectPut<T extends { id: string }>(
  ownerId: string,
  project: T,
): Promise<T> {
  if (!isTauri()) {
    localStorage.setItem(
      webKey("project", project.id),
      JSON.stringify(project),
    );
    localStorage.setItem(webKey("project-owner", project.id), ownerId);
    return project;
  }
  return invoke<T>("local_project_put", { ownerId, project });
}

export async function localProjectGet<T>(
  id: string,
  ownerId: string,
): Promise<T | null> {
  if (!isTauri()) {
    migrateWebProjectsToSharedWorkspace();
    if (localStorage.getItem(webKey("project-owner", id)) !== ownerId)
      return null;
    const raw = localStorage.getItem(webKey("project", id));
    return raw ? (JSON.parse(raw) as T) : null;
  }
  return singleFlightRead(
    JSON.stringify(["local_project_get", id, ownerId]),
    () => invoke<T | null>("local_project_get", { id, ownerId }),
  );
}

export async function localProjectList<T>(
  query: LocalProjectListQuery,
): Promise<{ data: T[]; total: number }> {
  if (!isTauri()) {
    migrateWebProjectsToSharedWorkspace();
    const all: T[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(webKey("project", ""))) continue;
      const id = key.slice(webKey("project", "").length);
      if (localStorage.getItem(webKey("project-owner", id)) !== query.ownerId)
        continue;
      const raw = localStorage.getItem(key);
      if (raw) all.push(JSON.parse(raw) as T);
    }
    const values = all
      .filter((value) => {
        const project = value as Record<string, unknown>;
        if (query.projectType && project.projectType !== query.projectType)
          return false;
        const haystack =
          `${project.name ?? ""} ${project.description ?? ""}`.toLowerCase();
        return haystack.includes((query.search ?? "").toLowerCase());
      })
      .sort((a, b) => {
        const key = query.sortBy ?? "updatedAt";
        return String((b as Record<string, unknown>)[key]).localeCompare(
          String((a as Record<string, unknown>)[key]),
        );
      });
    const offset = (Math.max(1, query.page) - 1) * query.limit;
    return {
      data: values.slice(offset, offset + query.limit),
      total: values.length,
    };
  }
  const requestKey = JSON.stringify([
    "local_project_list",
    query.ownerId,
    query.page,
    query.limit,
    query.search ?? "",
    query.projectType ?? "",
    query.sortBy ?? "updatedAt",
  ]);
  return singleFlightRead(requestKey, () =>
    invoke<{ data: T[]; total: number }>("local_project_list", { query }),
  );
}

export async function localProjectDelete(
  id: string,
  ownerId: string,
): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(webKey("project", id));
    localStorage.removeItem(webKey("project-owner", id));
    return;
  }
  await invoke("local_project_delete", { id, ownerId });
}

const AUTH_ACTIVE_KEY = "active";

export async function cacheAuthProfile(user: User): Promise<void> {
  await localRecordPut("auth-profile", user.id, null, user);
  await localRecordPut("auth-state", AUTH_ACTIVE_KEY, null, {
    activeUserId: user.id,
  });
}

export async function getCachedAuthProfile(): Promise<User | null> {
  const state = await localRecordGet<{ activeUserId: string }>(
    "auth-state",
    AUTH_ACTIVE_KEY,
  );
  if (!state?.activeUserId) return null;
  return localRecordGet<User>("auth-profile", state.activeUserId);
}

export async function clearActiveAuthProfile(): Promise<void> {
  await localRecordDelete("auth-state", AUTH_ACTIVE_KEY);
}
