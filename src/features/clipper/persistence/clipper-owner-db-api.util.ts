import { invoke } from "@tauri-apps/api/core";

export interface ClipperOwnerRecord {
  id: string;
  name: string;
  avatarUrl?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  channelCount: number;
  projectCount: number;
}

export interface ClipperOwnerUpsertInput {
  id?: string;
  name: string;
  avatarUrl?: string | null;
  notes?: string;
}

export interface ClipperOwnerChannelRecord {
  id: string;
  ownerId: string;
  platform: string;
  externalId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClipperOwnerChannelUpsertInput {
  id?: string;
  ownerId: string;
  platform: string;
  externalId: string;
  displayName: string;
}

export interface ClipperProjectSummary {
  id: string;
  name: string;
  projectType: string;
}

export async function fetchClipperOwners(): Promise<ClipperOwnerRecord[]> {
  return invoke<ClipperOwnerRecord[]>("clipper_owners_list");
}

export async function fetchClipperOwner(ownerId: string): Promise<ClipperOwnerRecord> {
  return invoke<ClipperOwnerRecord>("clipper_owner_get", { ownerId });
}

export async function upsertClipperOwner(
  input: ClipperOwnerUpsertInput,
): Promise<ClipperOwnerRecord> {
  return invoke<ClipperOwnerRecord>("clipper_owner_upsert", { owner: input });
}

export async function deleteClipperOwner(ownerId: string): Promise<void> {
  return invoke("clipper_owner_delete", { ownerId });
}

export async function fetchClipperOwnerChannels(
  ownerId: string,
): Promise<ClipperOwnerChannelRecord[]> {
  return invoke<ClipperOwnerChannelRecord[]>("clipper_owner_channels_list", { ownerId });
}

export async function upsertClipperOwnerChannel(
  input: ClipperOwnerChannelUpsertInput,
): Promise<ClipperOwnerChannelRecord> {
  return invoke<ClipperOwnerChannelRecord>("clipper_owner_channel_upsert", { channel: input });
}

export async function deleteClipperOwnerChannel(channelId: string): Promise<void> {
  return invoke("clipper_owner_channel_delete", { channelId });
}

export async function setClipperProjectOwner(
  projectId: string,
  ownerId: string | null,
): Promise<void> {
  return invoke("clipper_project_set_owner", { projectId, ownerId });
}

export async function fetchClipperOwnerProjects(
  ownerId: string,
): Promise<ClipperProjectSummary[]> {
  return invoke<ClipperProjectSummary[]>("clipper_owner_projects_list", { ownerId });
}
